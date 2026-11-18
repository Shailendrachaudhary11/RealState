const User = require('../models/User');
const SearchLog = require('../models/SearchLog');
const Lead = require('../models/Lead');
const FavoriteProperty = require('../models/FavoriteProperty');
const Property = require('../models/Property');

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const parseMonthFilter = (query = {}) => {
  const now = new Date();
  let year = parseInt(query.year, 10) || now.getFullYear();
  let monthIndex = now.getMonth(); // Default: Current month (0-indexed)

  const filterQuery = query.month || query.date || query.filter;

  if (filterQuery) {
    if (typeof filterQuery === 'string' && filterQuery.includes('-')) {
      const parts = filterQuery.split('-');
      year = parseInt(parts[0], 10) || year;
      monthIndex = parseInt(parts[1], 10) - 1;
    } else if (!isNaN(Number(filterQuery))) {
      monthIndex = parseInt(filterQuery, 10) - 1;
    } else if (typeof filterQuery === 'string') {
      const cleanName = filterQuery.toLowerCase().trim();
      const foundIndex = monthNames.findIndex(m => m.toLowerCase().startsWith(cleanName));
      if (foundIndex !== -1) {
        monthIndex = foundIndex;
      }
    }
  }

  // Clamp monthIndex between 0 (Jan) and 11 (Dec)
  monthIndex = Math.max(0, Math.min(11, monthIndex));

  const startDate = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const endDate = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  const daysInMonth = endDate.getDate();
  const monthStr = String(monthIndex + 1).padStart(2, '0');

  return {
    year,
    monthIndex,
    monthStr,
    monthNumber: monthIndex + 1,
    monthName: monthNames[monthIndex],
    startDate,
    endDate,
    daysInMonth,
  };
};

const getUserActivityReport = async (req, res, next) => {
  try {
    const {
      year,
      monthIndex,
      monthName,
      startDate,
      endDate,
      daysInMonth,
    } = parseMonthFilter(req.query);

    const dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };

    // ----------------- 1. CARDS (Filter applied) -----------------
    const [totalUsers, activeUsers, inactiveUsers] = await Promise.all([
      User.countDocuments({ role: { $eq: 'buyer' }, ...dateFilter }),
      User.countDocuments({ role: { $eq: 'buyer' }, isActive: true, ...dateFilter }),
      User.countDocuments({ role: { $eq: 'buyer' }, isActive: false, ...dateFilter }),
    ]);

    // ----------------- 2. DATE-WISE REGISTRATION AGGREGATION -----------------
    const registrations = await User.aggregate([
      {
        $match: {
          role: { $eq: 'buyer' },
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fast lookup map { '2026-09-01': 2, ... }
    const countMap = {};
    let totalMonthRegistrations = 0;
    registrations.forEach(r => {
      countMap[r._id] = r.count;
      totalMonthRegistrations += r.count;
    });

    // Month ke har din ka record generate karo (jisme 0 count bhi ho) taaki frontend chart smooth bane
    const dailyRegistrations = [];
    const monthStr = String(monthIndex + 1).padStart(2, '0');

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${year}-${monthStr}-${dayStr}`;
      dailyRegistrations.push({
        date: dateStr,
        day,
        count: countMap[dateStr] || 0,
      });
    }

    res.status(200).json({
      success: true,
      message: 'User activity report retrieved successfully',
      data: {
        cards: {
          totalUsers,
          activeUsers,
          inactiveUsers,
        },
        filter: {
          month: monthIndex + 1,
          monthName,
          year,
          daysInMonth,
          totalRegistrationsInMonth: totalMonthRegistrations,
        },
        dailyRegistrations,
      },
    });
  } catch (err) {
    console.error(`Get User Activity Report Error: ${err.message}`);
    next(err);
  }
};

const getAgentActivityReport = async (req, res, next) => {
  try {
    const {
      year,
      monthIndex,
      monthName,
      startDate,
      endDate,
      daysInMonth,
    } = parseMonthFilter(req.query);

    const dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };

    // ----------------- 1. CARDS (Filter applied) -----------------
    const [totalAgents, pendingAgents, approvedAgents, rejectedAgents, suspendedAgents] = await Promise.all([
      User.countDocuments({ role: { $eq: 'agent' }, ...dateFilter }),
      User.countDocuments({ role: { $eq: 'agent' }, status: 'pending', ...dateFilter }),
      User.countDocuments({ role: { $eq: 'agent' }, status: 'approved', ...dateFilter }),
      User.countDocuments({ role: { $eq: 'agent' }, status: 'rejected', ...dateFilter }),
      User.countDocuments({ role: { $eq: 'agent' }, status: 'suspended', ...dateFilter }),
    ]);

    // ----------------- 2. DATE-WISE REGISTRATION AGGREGATION -----------------
    const registrations = await User.aggregate([
      {
        $match: {
          role: { $eq: 'agent' },
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fast lookup map { '2026-09-01': 2, ... }
    const countMap = {};
    let totalMonthRegistrations = 0;
    registrations.forEach(r => {
      countMap[r._id] = r.count;
      totalMonthRegistrations += r.count;
    });

    // Month ke har din ka record generate karo (jisme 0 count bhi ho) taaki frontend chart smooth bane
    const dailyRegistrations = [];
    const monthStr = String(monthIndex + 1).padStart(2, '0');

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${year}-${monthStr}-${dayStr}`;
      dailyRegistrations.push({
        date: dateStr,
        day,
        count: countMap[dateStr] || 0,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Agent activity report retrieved successfully',
      data: {
        cards: {
          totalAgents,
          pendingAgents,
          approvedAgents,
          rejectedAgents,
          suspendedAgents,
        },
        filter: {
          month: monthIndex + 1,
          monthName,
          year,
          daysInMonth,
          totalRegistrationsInMonth: totalMonthRegistrations,
        },
        dailyRegistrations,
      },
    });
  } catch (err) {
    console.error(`Get Agent Activity Report Error: ${err.message}`);
    next(err);
  }
};


const searchProperty = async (req, res, next) => {
  try {
    const {
      year,
      monthIndex,
      monthStr,
      monthName,
      startDate,
      endDate,
      daysInMonth,
    } = parseMonthFilter(req.query);

    const matchQuery = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    // ----------------- 1. CARDS (Filter applied) -----------------
    const [
      totalSearches,
      successfulSearches,
      zeroResultSearches,
      aiSearches,
      manualSearches,
    ] = await Promise.all([
      SearchLog.countDocuments(matchQuery),
      SearchLog.countDocuments({ ...matchQuery, resultsCount: { $gt: 0 } }),
      SearchLog.countDocuments({ ...matchQuery, resultsCount: 0 }),
      SearchLog.countDocuments({ ...matchQuery, searchType: 'ai' }),
      SearchLog.countDocuments({ ...matchQuery, searchType: 'manual' }),
    ]);

    // Calculate percentages
    const zeroResultPercentage = totalSearches > 0
      ? Number(((zeroResultSearches / totalSearches) * 100).toFixed(2))
      : 0;

    const aiSearchPercentage = totalSearches > 0
      ? Number(((aiSearches / totalSearches) * 100).toFixed(2))
      : 0;

    const successfulSearchPercentage = totalSearches > 0
      ? Number(((successfulSearches / totalSearches) * 100).toFixed(2))
      : 0;

    // ----------------- 2. DATE-WISE SEARCH TREND AGGREGATION -----------------
    const dailyAggregation = await SearchLog.aggregate([
      {
        $match: matchQuery,
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const countMap = {};
    let totalMonthSearches = 0;
    dailyAggregation.forEach(item => {
      countMap[item._id] = item.count;
      totalMonthSearches += item.count;
    });

    // Month ke har din ka record generate karo (1st se 30/31 tak) taaki graph continuous rahe
    const dailySearches = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${year}-${monthStr}-${dayStr}`;
      dailySearches.push({
        date: dateStr,
        day,
        count: countMap[dateStr] || 0,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Property search report metrics retrieved successfully',
      data: {
        cards: {
          totalSearches,
          successfulSearchPercentage,
          zeroResultPercentage,
          aiSearchPercentage,
        },
        // // Backward compatibility ke liye flat fields
        // totalSearches,
        // successfulSearchPercentage,
        // zeroResultPercentage,
        // aiSearchPercentage,
        filter: {
          selectedMonth: `${year}-${monthStr}`,
          month: monthIndex + 1,
          monthName,
          year,
          daysInMonth,
          totalSearchesInMonth: totalMonthSearches,
        },
        dailySearches,
      },
    });
  } catch (err) {
    console.error(`Get Property Search Report Error: ${err.message}`);
    next(err);
  }
};

const getLeadReport = async (req, res, next) => {
  try {
    const {
      year,
      monthIndex,
      monthStr,
      monthName,
      startDate,
      endDate,
      daysInMonth,
    } = parseMonthFilter(req.query);

    const dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };

    // ----------------- 1. CARDS (Filter applied) -----------------
    // enum: ['pending', 'approved', 'completed', 'rejected']
    const [
      totalLeads,
      pendingLeads,
      approvedLeads,
      completedLeads,
      rejectedLeads,
    ] = await Promise.all([
      Lead.countDocuments(dateFilter),
      Lead.countDocuments({ status: 'pending', ...dateFilter }),
      Lead.countDocuments({ status: 'approved', ...dateFilter }),
      Lead.countDocuments({ status: 'completed', ...dateFilter }),
      Lead.countDocuments({ status: 'rejected', ...dateFilter }),
    ]);

    // ----------------- 2. DATE-WISE LEAD GENERATION AGGREGATION -----------------
    const leadsAggregation = await Lead.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const countMap = {};
    let totalMonthLeads = 0;
    leadsAggregation.forEach(item => {
      countMap[item._id] = item.count;
      totalMonthLeads += item.count;
    });

    // Month ke har din ka record generate karo (jisme 0 count bhi ho)
    const dailyLeads = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${year}-${monthStr}-${dayStr}`;
      dailyLeads.push({
        date: dateStr,
        day,
        count: countMap[dateStr] || 0,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Lead report retrieved successfully',
      data: {
        cards: {
          totalLeads,
          pending: pendingLeads,
          approved: approvedLeads,
          completed: completedLeads,
          rejected: rejectedLeads,
        },
        filter: {
          selectedMonth: `${year}-${monthStr}`,
          month: monthIndex + 1,
          monthName,
          year,
          daysInMonth,
          totalLeadsInMonth: totalMonthLeads,
        },
        dailyLeads,
      },
    });
  } catch (err) {
    console.error(`Get Lead Report Error: ${err.message}`);
    next(err);
  }
};

const getAiSearchReport = async (req, res, next) => {
  try {
    const {
      year,
      monthIndex,
      monthStr,
      monthName,
      startDate,
      endDate,
      daysInMonth,
    } = parseMonthFilter(req.query);

    const dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };

    // Today midnight se start (aaj ki total AI searches)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // ----------------- 1. CARDS (Filter applied) -----------------
    const [
      totalPlatformSearches,
      totalAiSearches,
      todayAiSearches,
      successfulAiSearches,
    ] = await Promise.all([
      // Platform par selected month me total searches (Manual + AI)
      SearchLog.countDocuments(dateFilter),

      // Selected month me Total AI Searches
      SearchLog.countDocuments({ searchType: 'ai', ...dateFilter }),

      // Today's AI Searches (Midnight se lekar ab tak)
      SearchLog.countDocuments({
        searchType: 'ai',
        createdAt: { $gte: startOfToday },
      }),

      // Selected month me Successful AI searches (resultsCount > 0)
      SearchLog.countDocuments({ searchType: 'ai', resultsCount: { $gt: 0 }, ...dateFilter }),
    ]);

    // AI Adoption Rate (% of total searches done via AI in selected month)
    const aiAdoptionRate = totalPlatformSearches > 0
      ? Number(((totalAiSearches / totalPlatformSearches) * 100).toFixed(2))
      : 0;

    // AI Success Rate (% of AI searches that returned results > 0 in selected month)
    const successRate = totalAiSearches > 0
      ? Number(((successfulAiSearches / totalAiSearches) * 100).toFixed(2))
      : 0;

    // ----------------- 2. DAILY AI SEARCH TREND GRAPH AGGREGATION -----------------
    const dailyAggregation = await SearchLog.aggregate([
      {
        $match: {
          searchType: 'ai',
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const countMap = {};
    let totalMonthAiSearches = 0;
    dailyAggregation.forEach(item => {
      countMap[item._id] = item.count;
      totalMonthAiSearches += item.count;
    });

    // Month ke har din ka record generate karo (1st se lekar 30/31 tak) taaki graph continuous rahe
    const dailyAiSearches = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${year}-${monthStr}-${dayStr}`;
      dailyAiSearches.push({
        date: dateStr,
        day,
        count: countMap[dateStr] || 0,
      });
    }

    res.status(200).json({
      success: true,
      message: 'AI search report metrics retrieved successfully',
      data: {
        cards: {
          totalAiSearches,
          todayAiSearches,
          aiAdoptionRate, // e.g. 38.5%
          successRate,    // e.g. 85.0%
        },
        filter: {
          selectedMonth: `${year}-${monthStr}`,
          month: monthIndex + 1,
          monthName,
          year,
          daysInMonth,
          totalAiSearchesInMonth: totalMonthAiSearches,
        },
        dailyAiSearches,
      },
    });
  } catch (err) {
    console.error(`Get AI Search Report Error: ${err.message}`);
    next(err);
  }
};

const getSavedPropertiesReport = async (req, res, next) => {
  try {
    const {
      year,
      monthIndex,
      monthStr,
      monthName,
      startDate,
      endDate,
      daysInMonth,
    } = parseMonthFilter(req.query);

    const dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };

    // Today midnight se start (aaj kitni properties save hui)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // ----------------- 1. 4 CARDS (Under filters) -----------------
    const [
      totalSavedProperties,
      uniquePropertiesResult,
      uniqueUsersResult,
      todaySavedProperties,
    ] = await Promise.all([
      // Selected month me total saves
      FavoriteProperty.countDocuments(dateFilter),

      // Selected month me kitni unique properties shortlist hui
      FavoriteProperty.distinct('property', dateFilter),

      // Selected month me kitne unique users ne save kiya 1000+5
      FavoriteProperty.distinct('user', dateFilter),

      // Aaj kitni properties save hui
      FavoriteProperty.countDocuments({ createdAt: { $gte: startOfToday } }),
    ]);

    const uniquePropertiesSaved = uniquePropertiesResult.length;
    const uniqueUsers = uniqueUsersResult.length;

    // Average saves per property
    const averageSavesPerProperty = uniquePropertiesSaved > 0
      ? Number((totalSavedProperties / uniquePropertiesSaved).toFixed(2))
      : 0;

    // ----------------- 2. DAILY SAVED PROPERTY DATE-WISE AGGREGATION -----------------
    const dailyAggregation = await FavoriteProperty.aggregate([
      {
        $match: dateFilter,
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const countMap = {};
    let totalMonthSaves = 0;
    dailyAggregation.forEach(item => {
      countMap[item._id] = item.count;
      totalMonthSaves += item.count;
    });

    // Month ke har din ka record generate karo (1st se lekar 30/31 tak) taaki graph continuous rahe
    const dailySavedProperties = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${year}-${monthStr}-${dayStr}`;
      dailySavedProperties.push({
        date: dateStr,
        day,
        count: countMap[dateStr] || 0,
      });
    }

    // Language identification (default 'en')
    const rawInput = req.query.lang || req.query.language || 'en';
    const lang = (rawInput.toLowerCase().includes('spanish') || rawInput.toLowerCase() === 'es') ? 'es' : 'en';

    // ----------------- 3. TOP 10 SAVED PROPERTIES UNDER FILTERS -----------------
    const rawTopSaved = await FavoriteProperty.aggregate([
      {
        $match: dateFilter,
      },
      {
        $group: {
          _id: '$property',
          savesCount: { $sum: 1 },
        },
      },
      { $sort: { savesCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'properties',
          localField: '_id',
          foreignField: '_id',
          as: 'property',
        },
      },
      {
        $unwind: {
          path: '$property',
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $lookup: {
          from: 'amenities',
          localField: 'property.amenities',
          foreignField: '_id',
          as: 'amenityDetails',
        },
      },
      {
        $project: {
          _id: '$property._id',
          title: '$property.title',
          description: '$property.description',
          price: '$property.price',
          listingType: '$property.listingType',
          propertyType: '$property.propertyType',
          bedrooms: '$property.bedrooms',
          bathrooms: '$property.bathrooms',
          size: '$property.size',
          sizeUnit: '$property.sizeUnit',
          location: '$property.location',
          images: '$property.images',
          agentDetails: '$property.agentDetails',
          status: '$property.status',
          amenityDetails: 1,
          savesCount: 1,
        },
      },
    ]);

    // Format top 10 saved properties with amenity names & localized title
    const topSavedProperties = rawTopSaved.map(item => {
      const formattedAmenities = (item.amenityDetails || []).map(amenity => {
        let amenityName = '';
        if (amenity.name && typeof amenity.name === 'object') {
          amenityName = amenity.name[lang] || amenity.name.en || '';
        } else if (typeof amenity.name === 'string') {
          amenityName = amenity.name;
        }

        return {
          _id: amenity._id,
          name: amenityName,
          rawName: amenity.name,
        };
      });

      let localizedTitle = item.title;
      if (item.title && typeof item.title === 'object') {
        localizedTitle = item.title[lang] || item.title.en || item.title;
      }

      const { amenityDetails, ...rest } = item;

      return {
        ...rest,
        title: localizedTitle,
        rawTitle: item.title,
        amenities: formattedAmenities,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Saved properties report retrieved successfully',
      data: {
        cards: {
          totalSavedProperties,
          uniquePropertiesSaved,
          uniqueUsers,
          averageSavesPerProperty,
        },
        filter: {
          selectedMonth: `${year}-${monthStr}`,
          month: monthIndex + 1,
          monthName,
          year,
          daysInMonth,
          totalSavesInMonth: totalSavedProperties,
        },
        dailySavedProperties,
        topSavedProperties,
      },
    });

  } catch (err) {
    console.error(`Get Saved Properties Report Error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  getUserActivityReport,
  getAgentActivityReport,
  searchProperty,
  getLeadReport,
  getAiSearchReport,
  getSavedPropertiesReport,
};