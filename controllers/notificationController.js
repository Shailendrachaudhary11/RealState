const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { resolveLanguage, formatNotificationData, getLocalizedMessage } = require('../utils/languageHelper');


const getMyNotifications = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);
    const query = { recipient: userId };
    const fetchTime = new Date();

    const [notifications, totalMatching, unreadCount] = await Promise.all([
      Notification.find(query)
        .populate('sender', 'name email phone profileImage')
        .select('-data -__v')
        .sort({ createdAt: -1 }),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipient: userId }),
      // Record the timestamp when user fetched notifications
      User.findByIdAndUpdate(userId, { lastFetchNotification: fetchTime }),
    ]);

    const formattedNotifications = notifications.map(notif => formatNotificationData(notif, lang));

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('notificationsRetrieved', lang),
      count: formattedNotifications.length,
      data: {
        language: lang === 'es' ? 'Spanish' : 'English',
        notifications: formattedNotifications,
      },
    });
  } catch (err) {
    console.error(`Get my notifications error: ${err.message}`);
    next(err);
  }
};

const markNotificationAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error(getLocalizedMessage('invalidNotificationId', lang));
      error.statusCode = 400;
      return next(error);
    }

    const notification = await Notification.findOne({ _id: id, recipient: userId });
    if (!notification) {
      const error = new Error(getLocalizedMessage('notificationNotFound', lang));
      error.statusCode = 404;
      return next(error);
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    const notificationResponse = formatNotificationData(notification, lang);
    delete notificationResponse.data;
    delete notificationResponse.__v;

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('notificationRead', lang),
      data: notificationResponse,
    });
  } catch (err) {
    console.error(`Mark notification as read error: ${err.message}`);
    next(err);
  }
};

const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    const result = await Notification.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('notificationsAllRead', lang),
      data: {
        modifiedCount: result.modifiedCount,
      },
    });
  } catch (err) {
    console.error(`Mark all notifications as read error: ${err.message}`);
    next(err);
  }
};

const deleteNotification = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error(getLocalizedMessage('invalidNotificationId', lang));
      error.statusCode = 400;
      return next(error);
    }

    const notification = await Notification.findOneAndDelete({ _id: id, recipient: userId });
    if (!notification) {
      const error = new Error(getLocalizedMessage('notificationNotFound', lang));
      error.statusCode = 404;
      return next(error);
    }

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('notificationDeleted', lang),
      data: {
        id,
      },
    });
  } catch (err) {
    console.error(`Delete notification error: ${err.message}`);
    next(err);
  }
};

const deleteAllNotifications = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    const result = await Notification.deleteMany({ recipient: userId });

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('allNotificationsDeleted', lang),
      data: {
        deletedCount: result.deletedCount,
      },
    });
  } catch (err) {
    console.error(`Delete all notifications error: ${err.message}`);
    next(err);
  }
};

const getNewNotifications = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    // Fetch user's recorded lastFetchNotification timestamp
    const user = await User.findById(userId).select('lastFetchNotification');
    const lastFetchNotification = user ? user.lastFetchNotification : null;

    const query = { recipient: userId };
    if (lastFetchNotification) {
      query.createdAt = { $gt: lastFetchNotification };
    }

    const [countNewNotification, newNotifications, unreadCount] = await Promise.all([
      Notification.countDocuments(query),
      Notification.find(query)
        .populate('sender', 'name email phone profileImage')
        .select('-data -__v')
        .sort({ createdAt: -1 }),
      Notification.countDocuments({ recipient: userId, isRead: false }),
    ]);

    // Optional: if client passes ?updateFetch=true, update the timestamp
    if (req.query.updateFetch === 'true' || req.query.updateLastFetch === 'true') {
      await User.findByIdAndUpdate(userId, { lastFetchNotification: new Date() });
    }

    res.status(200).json({
      success: true,
      message: getLocalizedMessage('newNotificationsCount', lang),
      data: {
        countNewNotification,
        lastFetchNotification
      },
    });
  } catch (err) {
    console.error(`Get new notifications error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  deleteAllNotifications,
  getNewNotifications,
  getNewNotification: getNewNotifications,
};