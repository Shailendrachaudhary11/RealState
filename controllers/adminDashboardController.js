const User = require('../models/User');
const Property = require('../models/Property');
const Lead = require('../models/Lead');
const SearchLog = require('../models/SearchLog');
const Log = require('../models/Log');

// Percentage calculate karne ke liye helper function
const calculatePercentageChange = (current, previous) => {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  const change = ((current - previous) / previous) * 100;
  return Number(change.toFixed(2)); // Round off to 2 decimal places
};

const getDashboardCards = async (req, res, next) => {
  try {
    const now = new Date();

    // 1. Current month ki start date (e.g. 1st of this month, 00:00:00)
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 2. Previous month ki start aur end date
    const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPreviousMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    // Helper function taaki baar-baar code repeat na karna pade
    const getMetricData = async (Model, filter = {}) => {
      const [total, currentMonth, previousMonth] = await Promise.all([
        Model.countDocuments(filter),
        Model.countDocuments({
          ...filter,
          createdAt: { $gte: startOfCurrentMonth },
        }),
        Model.countDocuments({
          ...filter,
          createdAt: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth },
        }),
      ]);

      const percentageChange = calculatePercentageChange(currentMonth, previousMonth);

      return {
        total,
        // currentMonth,
        // previousMonth,
        percentageChange, // e.g., 25.5 ya -10.2
        trend: percentageChange >= 0 ? 'increase' : 'decrease',
      };
    };

    // Sabhi metrics ko parallelly fetch karenge
    const [users, agents, pendingAgents, properties, leads] = await Promise.all([
      getMetricData(User, { role: 'buyer' }),
      getMetricData(User, { role: 'agent' }),
      getMetricData(User, { role: 'agent', status: 'pending' }),
      getMetricData(Property),
      getMetricData(Lead),
    ]);

    const [totalLeads, pendingLeads, approvedLeads, completedLeads, rejectedLeads, closedLeads] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments({ status: 'pending' }),
      Lead.countDocuments({ status: 'approved' }),
      Lead.countDocuments({ status: 'completed' }),
      Lead.countDocuments({ status: 'rejected' }),
      Lead.countDocuments({ status: 'closed' }),
    ]);

    const [totalAiSearches, successfulAiSearches, failedAiSearches] = await Promise.all([
      SearchLog.countDocuments({ searchType: 'ai' }),
      SearchLog.countDocuments({ searchType: 'ai', resultsCount: { $gt: 0 } }),
      SearchLog.countDocuments({ searchType: 'ai', resultsCount: 0 }),
    ]);

    const successRate = totalAiSearches > 0
      ? ((successfulAiSearches / totalAiSearches) * 100).toFixed(2)
      : 0;

    const failureRate = totalAiSearches > 0
      ? ((failedAiSearches / totalAiSearches) * 100).toFixed(2)
      : 0;

    res.status(200).json({
      success: true,
      message: 'Dashboard card metrics retrieved successfully',
      data: {
        users,
        agents,
        // pendingAgents,
        properties,
        leads,
        leadStatuses: {
          total: totalLeads,
          pending: pendingLeads,
          approved: approvedLeads,
          completed: completedLeads,
          rejected: rejectedLeads,
          closed: closedLeads
        },
        AIUserSearchAnalytics: {
          totalAiSearches,
          successRate: `${successRate}%`,
          failureRate: `${failureRate}%`,
        },
      },
    });
  } catch (err) {
    console.error(`Get dashboard cards error: ${err.message}`);
    next(err);
  }
};

const getSearchAnalytics = async (req, res, next) => {
  try {
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    // Aaj ki start date (Midnight 00:00:00)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalSearches,
      todaySearches,
      topLocations,
      topBhkFilters,
      zeroResultSearches,
      dailyVolume,
    ] = await Promise.all([
      // Total Searches count
      SearchLog.countDocuments(),

      // Today's Search count (Midnight se ab tak)
      SearchLog.countDocuments({ createdAt: { $gte: startOfToday } }),

      // 1. Top 10 Locations
      SearchLog.aggregate([
        { $match: { location: { $exists: true, $ne: '' } } },
        { $group: { _id: '$location', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { location: '$_id', count: 1, _id: 0 } },
      ]),

      // 2. Top BHK Demand (1 BHK, 2 BHK, 3 BHK)
      SearchLog.aggregate([
        { $match: { 'filters.bedrooms': { $exists: true, $ne: null } } },
        { $group: { _id: '$filters.bedrooms', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $project: { bhk: { $concat: [{ $toString: '$_id' }, ' BHK'] }, count: 1, _id: 0 } },
      ]),

      // 3. Zero Result Searches (Aise searches jahan 0 properties mili)
      SearchLog.aggregate([
        { $match: { resultsCount: 0, location: { $exists: true, $ne: '' } } },
        {
          $group: {
            _id: '$location',
            unmetSearches: { $sum: 1 },
          },
        },
        { $sort: { unmetSearches: -1 } },
        { $limit: 10 },
        { $project: { location: '$_id', unmetSearches: 1, _id: 0 } },
      ]),

      // 4. Daily Search Volume Trend (Pichle 7 Din ka Graph Data)
      SearchLog.aggregate([
        { $match: { createdAt: { $gte: last7Days } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { date: '$_id', count: 1, _id: 0 } },
      ]),

      // 5. AI Search Analytics
      SearchLog.countDocuments({ searchType: 'ai' }),
      SearchLog.countDocuments({ searchType: 'ai', resultsCount: { $gt: 0 } }),
      SearchLog.countDocuments({ searchType: 'ai', resultsCount: 0 }),
    ]);

    res.status(200).json({
      success: true,
      message: 'Search analytics retrieved successfully',
      data: {
        totalSearches,
        todaySearches,
        topLocations,
        // topBhkFilters,
        zeroResultSearches,
        // dailyVolume,
      },
    });
  } catch (err) {
    console.error(`Get search analytics error: ${err.message}`);
    next(err);
  }
};

// const getAiUserSearchAnalytics = async (req, res, next) => {
//   try {
//     const [totalAiSearches, successfulAiSearches, failedAiSearches] = await Promise.all([
//       SearchLog.countDocuments({ searchType: 'ai' }),
//       SearchLog.countDocuments({ searchType: 'ai', resultsCount: { $gt: 0 } }),
//       SearchLog.countDocuments({ searchType: 'ai', resultsCount: 0 }),
//     ]);


//     const successRate = totalAiSearches > 0
//       ? ((successfulAiSearches / totalAiSearches) * 100).toFixed(2)
//       : 0;

//     const failureRate = totalAiSearches > 0
//       ? ((failedAiSearches / totalAiSearches) * 100).toFixed(2)
//       : 0;

//     res.status(200).json({
//       success: true,
//       message: 'AI user search analytics retrieved successfully',
//       data: {
//         totalAiSearches,
//         successRate: `${successRate}%`,
//         failureRate: `${failureRate}%`,
//       },
//     });
//   } catch (err) {
//     console.error(`Get AI user search analytics error: ${err.message}`);
//     next(err);
//   }
// }

const getLogs = async (req, res, next) => {
  try {
    const { action, startDate, endDate, page = 1, limit = 10 } = req.query;

    // Filter query banayenge
    const query = {};

    // Optional 'action' filter (create, edit, delete)
    if (action) {
      const cleanAction = action.toString().toLowerCase().trim();
      if (['create', 'edit', 'delete'].includes(cleanAction)) {
        query.action = cleanAction;
      }
    }

    // Optional date range filter (startDate, endDate)
    if (startDate || endDate) {
      query.createdAt = {};

      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0); // Din ki shuruat (00:00:00.000)
          query.createdAt.$gte = start;
        }
      }

      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999); // Din ka aakhri pal (23:59:59.999)
          query.createdAt.$lte = end;
        }
      }
    }
    // Pagination calculations
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;
    // Parallel fetch: Logs list aur Total count
    const [logs, totalLogs] = await Promise.all([
      Log.find(query)
        .populate('userId', 'name email role') // User ki basic info laane ke liye
        .sort({ createdAt: -1 })              // Latest logs sabse upar
        .skip(skip)
        .limit(limitNum),
      Log.countDocuments(query),
    ]);
    res.status(200).json({
      success: true,
      message: 'Logs retrieved successfully',
      data: {
        totalLogs,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalLogs / limitNum) || 1,
        logs,
      },
    });
  } catch (err) {
    console.error(`Get logs error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  getDashboardCards,
  getSearchAnalytics,
  getLogs
};