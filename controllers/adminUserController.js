const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const FavoriteProperty = require('../models/FavoriteProperty');
const Agency = require('../models/Agency');
const GeneralSetting = require('../models/GeneralSetting');
const Tier = require('../models/Tier');
const { resolveLanguage, getLocalizedMessage } = require('../utils/languageHelper');

const parseDateFilter = (query, defaultDays = null) => {
  const rawFilter = query.filter || query.range || query.period || query.timeRange || query.days;
  const now = new Date();
  let startDate = null;
  let endDate = new Date(now);
  let label = 'all';
  let days = null;

  if (query.startDate) {
    startDate = new Date(query.startDate);
    if (query.endDate) {
      endDate = new Date(query.endDate);
      if (typeof query.endDate === 'string' && query.endDate.length === 10) {
        endDate.setHours(23, 59, 59, 999);
      }
    }
    label = 'custom';
  } else if (rawFilter) {
    const str = String(rawFilter).trim().toLowerCase();
    const cleanStr = str.replace(/[_\s-]+/g, '');

    if (['7', '7d', '7days', 'last7days', 'last7day'].includes(cleanStr)) {
      days = 7;
      label = 'last 7 days';
    } else if (['30', '30d', '30days', 'last30days', 'last30day'].includes(cleanStr)) {
      days = 30;
      label = 'last 30 days';
    } else if (['90', '90d', '90days', 'last90days', 'last90day'].includes(cleanStr)) {
      days = 90;
      label = 'last 90 days';
    } else if (cleanStr === 'all' || cleanStr === 'alltime') {
      days = null;
      label = 'all';
    } else if (!isNaN(Number(rawFilter)) && Number(rawFilter) > 0) {
      days = parseInt(rawFilter, 10);
      label = `last ${days} days`;
    }
  } else if (defaultDays) {
    days = defaultDays;
    label = `last ${defaultDays} days`;
  }

  if (days && !startDate) {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
  }

  return {
    startDate,
    endDate,
    label,
    days,
  };
};

const buildTrendBuckets = (startDate, endDate, days, rawDailyTrend = []) => {
  if (!startDate || !endDate) {
    return {
      bucketInterval: 'none',
      trend: rawDailyTrend,
    };
  }

  // Map daily aggregation records by YYYY-MM-DD
  const dailyMap = {};
  rawDailyTrend.forEach((item) => {
    if (item && item.date) {
      dailyMap[item.date] = {
        total: item.count || 0,
        buyers: item.buyers || 0,
        agents: item.agents || 0,
      };
    }
  });

  const formatDateStr = (d) => d.toISOString().split('T')[0];

  // Determine cap size
  let capDays = 1; // 7 days: day-by-day
  if (days === 30) {
    capDays = 5; // 30 days: 5 days cap
  } else if (days === 90) {
    capDays = 10; // 90 days: 10 days cap
  } else if (days && days > 7) {
    capDays = days <= 30 ? 5 : 10;
  }

  const buckets = [];
  const oneDayMs = 24 * 60 * 60 * 1000;

  let currentStart = new Date(startDate);
  let bucketIndex = 1;

  while (currentStart < endDate) {
    const currentEnd = new Date(currentStart.getTime() + (capDays * oneDayMs) - 1);
    const effectiveEnd = currentEnd > endDate ? new Date(endDate) : currentEnd;

    const startStr = formatDateStr(currentStart);
    const endStr = formatDateStr(effectiveEnd);

    // Sum all days falling in this bucket window
    let total = 0;
    let buyers = 0;
    let agents = 0;

    const iterDate = new Date(currentStart);
    while (iterDate <= effectiveEnd) {
      const dKey = formatDateStr(iterDate);
      if (dailyMap[dKey]) {
        total += dailyMap[dKey].total;
        buyers += dailyMap[dKey].buyers;
        agents += dailyMap[dKey].agents;
      }
      iterDate.setUTCDate(iterDate.getUTCDate() + 1);
    }

    let bucketName;
    let label;
    if (capDays === 1) {
      bucketName = `Day ${bucketIndex}`;
      label = startStr;
    } else {
      const startDayNum = (bucketIndex - 1) * capDays + 1;
      const endDayNum = Math.min(bucketIndex * capDays, days || (bucketIndex * capDays));
      bucketName = `Days ${startDayNum}-${endDayNum}`;
      label = `${startStr} to ${endStr}`;
    }

    buckets.push({
      bucket: bucketName,
      label,
      startDate: startStr,
      endDate: endStr,
      totalUsers: total,
      buyers,
      agents,
    });

    currentStart = new Date(currentStart.getTime() + (capDays * oneDayMs));
    bucketIndex++;
  }

  const bucketInterval = capDays === 1 ? '1 day' : `${capDays} days cap`;

  return {
    bucketInterval,
    trend: buckets,
  };
};

const getAllUsers = async (req, res, next) => {
  try {
    const { search, role = "buyer", isActive, status, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const query = {};

    // Filters
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    if (role && role !== 'all') {
      query.role = role;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Optional date filtering (last 7 days, last 30 days, last 90 days, or custom) 
    const { startDate, endDate } = parseDateFilter(req.query, null);
    if (startDate) {
      query.createdAt = { $gte: startDate, $lte: endDate };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const totalUsers = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password -recentlyViewed -__v')
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum);

    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: {
        users,
        pagination: {
          total: totalUsers,
          page: parseInt(page),
          limit: limitNum,
          pages: Math.ceil(totalUsers / limitNum)
        }
      }
    });
  } catch (err) {
    console.error(`Get all users error: ${err.message}`);
    next(err);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const userId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const error = new Error('Invalid User ID format');
      error.statusCode = 400;
      return next(error);
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      return next(error);
    }

    // Fetch user's saved/favorite properties
    const favorites = await FavoriteProperty.find({ user: userId })
      .populate({
        path: 'property',
        populate: { path: 'amenities' }
      });

    // Clean up saved properties (filter out any deleted properties)
    const savedProperties = favorites
      .filter(fav => fav.property !== null)
      .map(fav => fav.property);

    res.status(200).json({
      success: true,
      message: 'User details retrieved successfully',
      data: {
        user,
        savedProperties
      }
    });

  } catch (err) {
    console.error(`Get user by ID error: ${err.message}`);
    next(err);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const userId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      const error = new Error('Invalid User ID format');
      error.statusCode = 400;
      return next(error);
    }

    const user = await User.findById(userId);
    if (!user) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      const error = new Error('User not found');
      error.statusCode = 404;
      return next(error);
    }

    // Check if updating email, and if it's already in use by another user
    if (req.body.email && req.body.email !== user.email) {
      const emailExists = await User.findOne({ email: req.body.email });
      if (emailExists) {
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        const error = new Error('Email is already in use by another user');
        error.statusCode = 400;
        return next(error);
      }
      user.email = req.body.email;
    }

    // Update other fields
    if (req.body.name) user.name = req.body.name;
    if (req.body.phone) user.phone = req.body.phone;
    if (req.body.role) user.role = req.body.role;
    if (req.body.status) user.status = req.body.status;
    const incomingAgency = req.body.agency || req.body.agencyId;
    if (incomingAgency) user.agency = incomingAgency;
    if (req.body.licenseNumber) {
      user.licenseNumber = req.body.licenseNumber;
      user.liceneseNumber = req.body.licenseNumber;
    }
    if (req.body.liceneseNumber) {
      user.liceneseNumber = req.body.liceneseNumber;
      user.licenseNumber = req.body.liceneseNumber;
    }
    if (req.body.isActive !== undefined) user.isActive = req.body.isActive;

    // Handle new profile image upload
    if (req.file) {
      // Delete old profile image if it exists on disk
      if (user.profileImage) {
        const oldImagePath = path.join(__dirname, '..', user.profileImage);
        if (fs.existsSync(oldImagePath)) {
          try {
            fs.unlinkSync(oldImagePath);
          } catch (unlinkErr) {
            console.error(`Failed to delete old image: ${unlinkErr.message}`);
          }
        }
      }
      user.profileImage = `/uploads/${req.file.filename}`;
    }

    const updatedUser = await user.save();

    // Exclude password from the returned object
    const userResponse = updatedUser.toObject();
    delete userResponse.password;

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: {
        user: userResponse
      }
    });
  } catch (err) {
    console.error(`Update user error: ${err.message}`);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {
        console.error(`Error deleting uploaded file: ${unlinkErr.message}`);
      }
    }
    next(err);
  }
};

const toggleUserStatus = async (req, res, next) => {
  try {
    const userId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const error = new Error('Invalid User ID format');
      error.statusCode = 400;
      return next(error);
    }

    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      return next(error);
    }

    // Defensive check: Admin cannot deactivate themselves
    if (userId === req.user._id.toString() && user.isActive) {
      const error = new Error('You cannot deactivate your own admin account');
      error.statusCode = 400;
      return next(error);
    }

    user.isActive = !user.isActive;
    await user.save();

    res.status(200).json({
      success: true,
      message: `User successfully ${user.isActive ? 'activated' : 'deactivated'}`,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        isActive: user.isActive
      }
    });
  } catch (err) {
    console.error(`Toggle user status error: ${err.message}`);
    next(err);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const userId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const error = new Error('Invalid User ID format');
      error.statusCode = 400;
      return next(error);
    }

    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      return next(error);
    }

    // Defensive check: Admin cannot delete their own account
    if (userId === req.user._id.toString()) {
      const error = new Error('You cannot delete your own admin account');
      error.statusCode = 400;
      return next(error);
    }

    // 1. Delete user profile image from disk if exists
    if (user.profileImage) {
      const imagePath = path.join(__dirname, '..', user.profileImage.replace(/^\//, ''));
      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (unlinkErr) {
          console.error(`Failed to delete user profile image: ${unlinkErr.message}`);
        }
      }
    }

    // 2. Cleanup user's favorite properties
    await FavoriteProperty.deleteMany({ user: userId });

    // 3. Cleanup user's saved searches
    const SavedSearch = require('../models/SavedSearch');
    await SavedSearch.deleteMany({ user: userId });

    // 4. Cleanup user's leads (both submitted by user or assigned to agent)
    const Lead = require('../models/Lead');
    await Lead.deleteMany({ $or: [{ user: userId }, { agent: userId }] });

    // 5. Cleanup user's notifications
    const Notification = require('../models/Notification');
    await Notification.deleteMany({ $or: [{ recipient: userId }, { sender: userId }] });

    // 6. Delete user document from DB
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: 'User and associated data deleted successfully',
      data: {
        id: userId,
        email: user.email,
        name: user.name,
      },
    });
  } catch (err) {
    console.error(`Delete user error: ${err.message}`);
    next(err);
  }
};

const getUsersReport = async (req, res, next) => {
  try {
    const {
      search,
      role,
      status,
      isActive,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Parse date filter: defaults to last 7 days if no filter specified
    const { startDate, endDate, label, days } = parseDateFilter(req.query, 7);

    // Build base date query for report metrics and users
    const dateQuery = {};
    if (startDate) {
      dateQuery.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    // Build user query for list retrieval (incorporating optional filters)
    const userQuery = { ...dateQuery };

    if (search) {
      userQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    if (role && role !== 'all') {
      userQuery.role = role;
    }

    if (status && status !== 'all') {
      userQuery.status = status;
    }

    if (isActive !== undefined && isActive !== '') {
      userQuery.isActive = isActive === 'true' || isActive === true;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Parallel aggregation for metrics & fetching paginated users
    const [statsResult, totalUsersCount, users] = await Promise.all([
      // 1. Aggregation for summary statistics and daily registration counts within the date range
      User.aggregate([
        { $match: dateQuery },
        {
          $facet: {
            total: [{ $count: 'count' }],
            buyers: [{ $match: { role: 'buyer' } }, { $count: 'count' }],
            agents: [{ $match: { role: 'agent' } }, { $count: 'count' }],
            admins: [{ $match: { role: 'admin' } }, { $count: 'count' }],
            active: [{ $match: { isActive: true } }, { $count: 'count' }],
            inactive: [{ $match: { isActive: false } }, { $count: 'count' }],
            statusBreakdown: [
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 },
                },
              },
            ],
            registrationTrend: [
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                  },
                  count: { $sum: 1 },
                  buyers: {
                    $sum: { $cond: [{ $eq: ['$role', 'buyer'] }, 1, 0] },
                  },
                  agents: {
                    $sum: { $cond: [{ $eq: ['$role', 'agent'] }, 1, 0] },
                  },
                },
              },
              { $sort: { _id: 1 } },
              {
                $project: {
                  _id: 0,
                  date: '$_id',
                  count: 1,
                  buyers: 1,
                  agents: 1,
                },
              },
            ],
          },
        },
      ]),

      // 2. Count total users matching userQuery (for pagination)
      User.countDocuments(userQuery),

      // 3. Retrieve user documents
      User.find(userQuery)
        .select('-password -recentlyViewed -__v')
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum),
    ]);

    // Format aggregation results
    const facetData = (statsResult && statsResult[0]) || {};
    const totalRegistered = facetData.total?.[0]?.count || 0;
    const totalBuyers = facetData.buyers?.[0]?.count || 0;
    const totalAgents = facetData.agents?.[0]?.count || 0;
    const totalAdmins = facetData.admins?.[0]?.count || 0;
    const activeUsers = facetData.active?.[0]?.count || 0;
    const inactiveUsers = facetData.inactive?.[0]?.count || 0;

    // Convert status array to key-value object
    const statusMap = {
      pending: 0,
      approved: 0,
      rejected: 0,
      suspended: 0,
    };
    if (Array.isArray(facetData.statusBreakdown)) {
      facetData.statusBreakdown.forEach((item) => {
        if (item && item._id) {
          statusMap[item._id] = item.count;
        }
      });
    }

    // Build capped interval trend buckets:
    // - Last 7 days: 1-day interval (day-by-day: kis din kitne users account bnaya)
    // - Last 30 days: 5-days cap (is beech me kitne user account create hue)
    // - Last 90 days: 10-days cap (10 ka cap krke kitne user account register hue)
    const { bucketInterval, trend: registrationTrend } = buildTrendBuckets(
      startDate,
      endDate,
      days,
      facetData.registrationTrend || []
    );

    res.status(200).json({
      success: true,
      message: 'User report retrieved successfully',
      data: {
        filter: {
          applied: label,
          days: days,
          bucketInterval,
          startDate: startDate ? startDate.toISOString() : null,
          endDate: endDate ? endDate.toISOString() : null,
        },
        summary: {
          totalUsers: totalRegistered,
          buyers: totalBuyers,
          agents: totalAgents,
          admins: totalAdmins,
          activeUsers,
          inactiveUsers,
          statusBreakdown: statusMap,
        },
        registrationTrend,
        users,
        pagination: {
          total: totalUsersCount,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(totalUsersCount / limitNum),
        },
      },
    });
  } catch (err) {
    console.error(`Get users report error: ${err.message}`);
    next(err);
  }
};

// agency management

const addAgency = async (req, res, next) => {
  try {
    const {
      name,
      description,
      isActive,
      isVerified,
    } = req.body;


    // if (!req.file) {
    //   const error = new Error("Agency logo is required");
    //   error.status = 400;
    //   return next(error);
    // }

    const normalizedName = name.trim();

    const agency = await Agency.findOne({
      name: {
        $regex: `^${normalizedName}$`,
        $options: "i",
      },
    }).select("_id name");

    if (agency) {
      const error = new Error(
        "Agency name already exists. Please use a different name."
      );

      error.status = 409;
      return next(error);
    }

    let logoAgency = null;
    if (req.file) {
      logoAgency = `/uploads/${req.file.filename}`;
    }

    const newAgency = await Agency.create({
      name: normalizedName,
      logo: logoAgency,
      description,
      isActive,
      isVerified,
    });

    return res.status(201).json({
      success: true,
      message: "Agency created successfully",
      data: newAgency,
    });
  } catch (error) {
    // MongoDB duplicate-key error
    if (error.code === 11000) {
      error.status = 409;
      error.message = "Agency name already exists";
    }

    next(error);
  }
};

const updateAgency = async (req, res, next) => {
  try {
    const { id } = req.params;
    // 1. req.body se tier bhi nikaalein:
    const { name, description, isActive, isVerified, website, tier, agentSeatsLimit, coveredAgentsCount } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) { }
      }
      const error = new Error("Invalid Agency ID format");
      error.statusCode = 400;
      error.status = 400;
      return next(error);
    }

    const agency = await Agency.findById(id);
    if (!agency) {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) { }
      }
      const error = new Error("Agency not found");
      error.statusCode = 404;
      error.status = 404;
      return next(error);
    }

    // Name check
    if (name) {
      const normalizedName = name.trim();
      const existingAgency = await Agency.findOne({
        _id: { $ne: id },
        name: { $regex: `^${normalizedName}$`, $options: "i" },
      }).select("_id");

      if (existingAgency) {
        if (req.file) {
          try { fs.unlinkSync(req.file.path); } catch (e) { }
        }
        const error = new Error("Agency name already exists. Please use a different name.");
        error.statusCode = 409;
        error.status = 409;
        return next(error);
      }
      agency.name = normalizedName;
    }

    // Logo update check
    if (req.file) {
      if (agency.logo) {
        const oldLogoPath = path.join(__dirname, '..', agency.logo.replace(/^\//, ''));
        if (fs.existsSync(oldLogoPath)) {
          try { fs.unlinkSync(oldLogoPath); } catch (unlinkErr) { }
        }
      }
      agency.logo = `/uploads/${req.file.filename}`;
    }

    if (description !== undefined) agency.description = description;
    if (website !== undefined) agency.website = website;
    if (isActive !== undefined) agency.isActive = isActive;
    if (isVerified !== undefined) agency.isVerified = isVerified;

    // ✅ ================= TIER UPDATE LOGIC =================
    if (tier !== undefined) {
      if (tier === null || tier === '') {
        agency.tier = null;
        agency.isFoundingSponsor = false;
      } else {
        // Check karein kya yeh Tier database me exist karta hai
        const tierDoc = await Tier.findById(tier);
        if (!tierDoc) {
          if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) { }
          }
          const error = new Error("Diya gaya Tier ID database me nahi mila");
          error.statusCode = 404;
          error.status = 404;
          return next(error);
        }

        agency.tier = tierDoc._id;

        // Auto-Sync: Agar Admin ne Tier 3 (Sponsor) chuna hai,
        // toh isFoundingSponsor ko automatically true karein, warna false
        agency.isFoundingSponsor = (tierDoc.tierLevel === 3);
      }
    }

    // ✅ ================= AGENT SEATS / QUOTA UPDATE LOGIC =================
    if (agentSeatsLimit !== undefined) {
      agency.agentSeatsLimit = Number(agentSeatsLimit) < 0 ? 0 : Number(agentSeatsLimit);
    }
    if (coveredAgentsCount !== undefined) {
      agency.coveredAgentsCount = Number(coveredAgentsCount) < 0 ? 0 : Number(coveredAgentsCount);
    }

    await agency.save();

    // Populate karke return karein taaki response me full Tier object mil jaye
    await agency.populate('tier');

    return res.status(200).json({
      success: true,
      message: "Agency updated successfully",
      data: agency,
    });
  } catch (error) {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
    }
    if (error.code === 11000) {
      error.statusCode = 409;
      error.status = 409;
      error.message = "Agency name already exists";
    }
    next(error);
  }
};

const deleteAgency = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid Agency ID format");
      error.statusCode = 400;
      error.status = 400;
      return next(error);
    }

    const agency = await Agency.findById(id);
    if (!agency) {
      const error = new Error("Agency not found");
      error.statusCode = 404;
      error.status = 404;
      return next(error);
    }

    // Delete agency logo from disk if it exists
    if (agency.logo) {
      const logoPath = path.join(__dirname, '..', agency.logo.replace(/^\//, ''));
      if (fs.existsSync(logoPath)) {
        try {
          fs.unlinkSync(logoPath);
        } catch (unlinkErr) {
          console.error(`Failed to delete agency logo: ${unlinkErr.message}`);
        }
      }
    }

    await Agency.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Agency deleted successfully",
      data: {
        id: agency._id,
        name: agency.name,
      },
    });
  } catch (error) {
    console.error(`Delete agency error: ${error.message}`);
    next(error);
  }
};

const toggleAgencyStatus = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid Agency ID format");
      error.statusCode = 400;
      error.status = 400;
      return next(error);
    }

    const agency = await Agency.findById(id);
    if (!agency) {
      const error = new Error("Agency not found");
      error.statusCode = 404;
      error.status = 404;
      return next(error);
    }

    // If isActive is explicitly provided in body (e.g. true/false), set it; otherwise toggle current status
    if (req.body && req.body.isActive !== undefined) {
      agency.isActive = Boolean(req.body.isActive);
    } else {
      agency.isActive = !agency.isActive;
    }

    await agency.save();

    return res.status(200).json({
      success: true,
      message: `Agency successfully ${agency.isActive ? "activated" : "deactivated"}`,
      data: {
        id: agency._id,
        name: agency.name,
        isActive: agency.isActive,
      },
    });
  } catch (error) {
    console.error(`Toggle agency status error: ${error.message}`);
    next(error);
  }
};

const getAllAgenciesAdmin = async (req, res, next) => {
  try {
    const lang = resolveLanguage(req);
    const {
      search,
      isActive,
      page,
      limit,
      sortBy = 'createdAt',
      sortOrder = 'asc',
    } = req.query;

    const query = {};

    // Search filter across name and description
    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
      ];
    }

    // Filter by active/inactive if provided
    if (isActive !== undefined && isActive !== 'all') {
      query.isActive = isActive === 'true' || isActive === true;
    }

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const [totalAgencies, totalActive, totalInactive] = await Promise.all([
      Agency.countDocuments(query),
      Agency.countDocuments({ isActive: true }),
      Agency.countDocuments({ isActive: false }),
    ]);

    let agencyQuery = Agency.find(query).sort(sortObj).populate("tier");

    // If pagination params are provided
    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 10);
      const skip = (pageNum - 1) * limitNum;

      agencyQuery = agencyQuery.skip(skip).limit(limitNum);
      const agencies = await agencyQuery;

      return res.status(200).json({
        success: true,
        message: getLocalizedMessage('agenciesRetrieved', lang) || 'Agencies retrieved successfully',
        data: {
          agencies,
          stats: {
            total: totalAgencies,
            active: totalActive,
            inactive: totalInactive,
          },
          pagination: {
            total: totalAgencies,
            page: pageNum,
            limit: limitNum,
            pages: Math.ceil(totalAgencies / limitNum),
          },
        },
      });
    }

    // Default: return all matching agencies
    const agencies = await agencyQuery;

    return res.status(200).json({
      success: true,
      message: getLocalizedMessage('agenciesRetrieved', lang) || 'Agencies retrieved successfully',
      data: {
        agencies,
        stats: {
          total: totalAgencies,
          active: totalActive,
          inactive: totalInactive,
        },
        total: agencies.length,
      },
    });
  } catch (error) {
    console.error(`Get all agencies admin error: ${error.message}`);
    next(error);
  }
};

const getGeneralSettings = async (req, res, next) => {
  try {
    let settings = await GeneralSetting.findOne().populate('updatedBy', 'name email role');
    if (!settings) {
      settings = await GeneralSetting.create({
        appName: 'KleverProp',
        defaultCurrency: 'USD',
        supportEmail: 'support@kleverprop.com',
        supportNumber: '+1 809-000-0000',
        updatedBy: req.user ? req.user._id : null,
      });
      settings = await GeneralSetting.findById(settings._id).populate('updatedBy', 'name email role');
    }

    return res.status(200).json({
      success: true,
      message: 'General settings retrieved successfully',
      data: settings,
    });
  } catch (err) {
    console.error(`Get General Settings Error: ${err.message}`);
    next(err);
  }
};

const updateGeneralSettings = async (req, res, next) => {
  try {
    const { appName, defaultCurrency, supportEmail, supportNumber } = req.body;

    let settings = await GeneralSetting.findOne();
    if (!settings) {
      settings = new GeneralSetting({
        appName: appName ? appName.trim() : 'KleverProp',
        defaultCurrency: defaultCurrency || 'USD',
        supportEmail: supportEmail ? supportEmail.trim().toLowerCase() : 'support@kleverprop.com',
        supportNumber: supportNumber ? supportNumber.trim() : '+1 809-000-0000',
        updatedBy: req.user ? req.user._id : null,
      });
    } else {
      if (appName !== undefined && appName !== null) settings.appName = appName.trim();
      if (defaultCurrency !== undefined && defaultCurrency !== null) settings.defaultCurrency = defaultCurrency;
      if (supportEmail !== undefined && supportEmail !== null) settings.supportEmail = supportEmail.trim().toLowerCase();
      if (supportNumber !== undefined && supportNumber !== null) settings.supportNumber = supportNumber.trim();
      settings.updatedBy = req.user ? req.user._id : null;
    }

    await settings.save();
    const updatedSettings = await GeneralSetting.findById(settings._id).populate('updatedBy', 'name email role');

    return res.status(200).json({
      success: true,
      message: 'General settings updated successfully',
      data: updatedSettings,
    });
  } catch (err) {
    console.error(`Update General Settings Error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  toggleUserStatus,
  deleteUser,
  getUsersReport,
  getUserReport: getUsersReport,
  addAgency,
  updateAgency,
  editAgency: updateAgency,
  deleteAgency,
  toggleAgencyStatus,
  changeAgencyStatus: toggleAgencyStatus,
  getAllAgenciesAdmin,
  getAllAgencies: getAllAgenciesAdmin,
  getAgencyAdmin: getAllAgenciesAdmin,
  getGeneralSettings,
  updateGeneralSettings,
  editGeneralSettings: updateGeneralSettings,
};