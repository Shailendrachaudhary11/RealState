const mongoose = require('mongoose');
const Review = require('../models/Review');
const User = require('../models/User');
const Lead = require('../models/Lead');
const Property = require('../models/Property');
const Notification = require('../models/Notification');
const { resolveLanguage, getLocalizedMessage } = require('../utils/languageHelper');

const createAgentReview = async (req, res, next) => {
  try {
    const agentId = '6ad8a94cb28aaec8c976d21c';

    const { rating, comment, propertyId, property } = req.body;
    const userId = req.user._id;
    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      const error = new Error(lang === 'es' ? 'ID de asesor no válido' : 'Invalid Agent ID format');
      error.statusCode = 400;
      return next(error);
    }

    // Check if target agent exists
    const agent = await User.findOne({ _id: agentId, role: 'agent' });
    if (!agent) {
      const error = new Error(lang === 'es' ? 'Asesor no encontrado' : 'Agent not found');
      error.statusCode = 404;
      return next(error);
    }

    // Prevent self-review
    if (agentId.toString() === userId.toString()) {
      const error = new Error(lang === 'es' ? 'No puedes calificarte a ti mismo' : 'You cannot review yourself');
      error.statusCode = 400;
      return next(error);
    }

    // Check if buyer has prior interaction with this agent to mark as verified buyer
    const targetPropertyId = propertyId || property || null;
    const priorLead = await Lead.findOne({ user: userId, agent: agentId });
    const isVerifiedBuyer = Boolean(priorLead);

    // Upsert review (one review per user per agent)
    const review = await Review.findOneAndUpdate(
      { agent: agentId, user: userId },
      {
        rating: Number(rating),
        comment: (comment || '').trim(),
        property: targetPropertyId && mongoose.Types.ObjectId.isValid(targetPropertyId) ? targetPropertyId : null,
        isVerifiedBuyer,
        status: 'approved',
      },
      { new: true, upsert: true, runValidators: true }
    );

    // Send notification to the agent
    try {
      const reviewerName = req.user?.name || 'A client';
      await Notification.create({
        recipient: agentId,
        sender: userId,
        title: {
          en: '⭐ New Rating & Review Received!',
          es: '⭐ ¡Nueva calificación y reseña recibida!',
        },
        message: {
          en: `${reviewerName} gave you a ${rating}-star review.`,
          es: `${reviewerName} te dio una calificación de ${rating} estrellas.`,
        },
        type: 'SYSTEM',
        data: {
          reviewId: review._id,
          rating: Number(rating),
          link: '/agent/my-reviews',
        },
      });
    } catch (notifErr) {
      console.error(`Failed to send review notification: ${notifErr.message}`);
    }

    await review.populate('user', 'name profileImage');

    res.status(201).json({
      success: true,
      message: lang === 'es' ? 'Reseña enviada con éxito' : 'Review submitted successfully',
      data: review,
    });
  } catch (err) {
    console.error(`Create review error: ${err.message}`);
    next(err);
  }
};

const getAgentReviews = async (req, res, next) => {
  try {
    const agentId = '6ad8a94cb28aaec8c976d21c';
    const { page = 1, limit = 10 } = req.query;
    const lang = resolveLanguage(req);

    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      const error = new Error(lang === 'es' ? 'ID de asesor no válido' : 'Invalid Agent ID format');
      error.statusCode = 400;
      return next(error);
    }

    const agent = await User.findOne({ _id: agentId, role: 'agent' })
      .select('name profileImage tier agency status')
      .populate('tier')
      .populate('agency', 'name logo isFoundingSponsor tier');

    if (!agent) {
      const error = new Error(lang === 'es' ? 'Asesor no encontrado' : 'Agent not found');
      error.statusCode = 404;
      return next(error);
    }

    // Determine agent's tier level (1 = Basic/Free, 2 = Pro, 3 = Founding Sponsor)
    let tierLevel = 1;
    if (agent.tier && agent.tier.tierLevel) {
      tierLevel = agent.tier.tierLevel;
    } else if (agent.agency && agent.agency.isFoundingSponsor) {
      tierLevel = 3;
    }

    const isTier1 = (tierLevel === 1);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    // Fetch reviews
    const [reviews, totalCount, statsAgg] = await Promise.all([
      Review.find({ agent: agentId, status: 'approved' })
        .populate('user', 'name profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments({ agent: agentId, status: 'approved' }),
      Review.aggregate([
        { $match: { agent: new mongoose.Types.ObjectId(agentId), status: 'approved' } },
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$rating' },
            stars5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
            stars4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
            stars3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
            stars2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
            stars1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const stats = statsAgg[0] || {
      averageRating: 0,
      stars5: 0,
      stars4: 0,
      stars3: 0,
      stars2: 0,
      stars1: 0,
    };

    const avgRating = stats.averageRating ? Number(stats.averageRating.toFixed(1)) : 0;

    // Process reviews based on Commercial Tier rules
    let processedReviews = [];
    let reputationState = {};

    if (isTier1) {
      // Commercial Friction Rule: Blur and lock Tier 1 reviews
      reputationState = {
        isBlurred: true,
        isLocked: true,
        tierLevel: 1,
        tierName: 'Tier 1 — Basic',
        badge: 'LOCKED_REPUTATION',
        claimAndUpgradeModal: {
          showModal: true,
          title: lang === 'es' ? 'Desbloquear Reputación Verificada' : 'Unlock Verified Reputation',
          message:
            lang === 'es'
              ? 'Este asesor tiene opiniones de clientes protegidas por nuestra política de verificación. Actualiza a Pro para desbloquear calificaciones públicas y generar confianza directa.'
              : 'This agent has client reviews protected under our verification policy. Claim and upgrade to Pro to unlock public ratings and build verified consumer trust.',
          cta: lang === 'es' ? 'Reclamar y Actualizar a Pro' : 'Claim & Upgrade to Pro',
          upgradeLink: '/pricing',
        },
      };

      // Mask review text and author details
      processedReviews = reviews.map((r) => ({
        _id: r._id,
        rating: r.rating,
        comment: '••••••••••••••••••••••••••••••••••••••••',
        isVerifiedBuyer: r.isVerifiedBuyer,
        createdAt: r.createdAt,
        user: {
          name: 'Verified Client',
          profileImage: null,
        },
      }));
    } else {
      // High-Conversion Rule: Open reputation for Tier 2 and Tier 3
      reputationState = {
        isBlurred: false,
        isLocked: false,
        tierLevel,
        tierName: tierLevel === 3 ? 'Tier 3 — Founding Sponsor' : 'Tier 2 — Pro Agent',
        badge: 'VERIFIED_REPUTATION',
        claimAndUpgradeModal: null,
      };

      processedReviews = reviews.map((r) => ({
        _id: r._id,
        rating: r.rating,
        comment: r.comment,
        isVerifiedBuyer: r.isVerifiedBuyer,
        createdAt: r.createdAt,
        user: r.user ? {
          name: r.user.name,
          profileImage: r.user.profileImage,
        } : { name: 'Anonymous', profileImage: null },
      }));
    }

    res.status(200).json({
      success: true,
      message: lang === 'es' ? 'Reseñas obtenidas con éxito' : 'Reviews retrieved successfully',
      data: {
        agent: {
          id: agent._id,
          name: agent.name,
          profileImage: agent.profileImage,
          tierLevel,
        },
        reputation: {
          ...reputationState,
          averageRating: isTier1 ? null : avgRating,
          displayedRating: isTier1 ? '•••••' : avgRating,
          totalReviews: totalCount,
          starDistribution: isTier1
            ? null
            : {
              5: stats.stars5,
              4: stats.stars4,
              3: stats.stars3,
              2: stats.stars2,
              1: stats.stars1,
            },
        },
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(totalCount / limitNum) || 1,
        },
        reviews: processedReviews,
      },
    });
  } catch (err) {
    console.error(`Get agent reviews error: ${err.message}`);
    next(err);
  }
};

const getMyAgentReviews = async (req, res, next) => {
  try {
    const agentId = '6ad8a94cb28aaec8c976d21c';
    const lang = resolveLanguage(req);

    if (req.user.role !== 'agent' && req.user.role !== 'admin') {
      const error = new Error('Access denied. Only registered agents can view agent reviews.');
      error.statusCode = 403;
      return next(error);
    }

    const agent = await User.findById(agentId)
      .select('name tier agency')
      .populate('tier');

    let tierLevel = 1;
    if (agent && agent.tier && agent.tier.tierLevel) {
      tierLevel = agent.tier.tierLevel;
    }
    const isTier1 = (tierLevel === 1);

    const [reviews, totalCount, statsAgg] = await Promise.all([
      Review.find({ agent: agentId, status: 'approved' })
        .populate('user', 'name email phone profileImage')
        .sort({ createdAt: -1 })
        .lean(),
      Review.countDocuments({ agent: agentId, status: 'approved' }),
      Review.aggregate([
        { $match: { agent: new mongoose.Types.ObjectId(agentId), status: 'approved' } },
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$rating' },
            stars5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
            stars4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
            stars3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
            stars2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
            stars1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const stats = statsAgg[0] || {
      averageRating: 0,
      stars5: 0,
      stars4: 0,
      stars3: 0,
      stars2: 0,
      stars1: 0,
    };

    const avgRating = stats.averageRating ? Number(stats.averageRating.toFixed(1)) : 0;

    res.status(200).json({
      success: true,
      message: lang === 'es' ? 'Reseñas de asesor obtenidas con éxito' : 'Agent reviews retrieved successfully',
      data: {
        tierLevel,
        isBlurred: true,
        stats: {
          averageRating: avgRating,
          totalReviews: totalCount,
          starDistribution: {
            5: stats.stars5,
            4: stats.stars4,
            3: stats.stars3,
            2: stats.stars2,
            1: stats.stars1,
          },
        },
        reviews,
      },
    });
  } catch (err) {
    console.error(`Get my agent reviews error: ${err.message}`);
    next(err);
  }
};

const claimAgentProfile = async (req, res, next) => {
  try {
    const agentId = req.user._id;
    const { propertyId, agentPhone, agentEmail } = req.body;
    const lang = resolveLanguage(req);

    if (req.user.role !== 'agent') {
      const error = new Error('Only registered agents can claim listings.');
      error.statusCode = 403;
      return next(error);
    }

    const currentAgent = await User.findById(agentId);
    if (!currentAgent) {
      const error = new Error('Agent account not found');
      error.statusCode = 404;
      return next(error);
    }

    const query = { agent: null };
    const matchConditions = [];

    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      matchConditions.push({ _id: propertyId });
    }

    const phoneToMatch = agentPhone || currentAgent.phone;
    if (phoneToMatch) {
      const cleanDigits = phoneToMatch.replace(/[^0-9]/g, '').slice(-8);
      if (cleanDigits.length >= 7) {
        matchConditions.push({ 'agentDetails.phone': { $regex: cleanDigits } });
      }
    }

    const emailToMatch = agentEmail || currentAgent.email;
    if (emailToMatch) {
      matchConditions.push({ 'agentDetails.email': emailToMatch.trim().toLowerCase() });
    }

    if (matchConditions.length === 0) {
      return res.status(400).json({
        success: false,
        message: lang === 'es' ? 'Proporcione teléfono, correo electrónico o ID de propiedad para reclamar' : 'Provide phone, email, or property ID to claim listings',
      });
    }

    query.$or = matchConditions;

    // Update unassigned properties to point to this agent
    const result = await Property.updateMany(query, {
      $set: {
        agent: agentId,
        'agentDetails.name': currentAgent.name,
        'agentDetails.email': currentAgent.email,
        'agentDetails.phone': currentAgent.phone,
        'agentDetails.profileImage': currentAgent.profileImage,
      },
    });

    res.status(200).json({
      success: true,
      message:
        lang === 'es'
          ? `¡Perfil reclamado con éxito! Se vincularon ${result.modifiedCount} propiedades a su cuenta.`
          : `Profile claimed successfully! Linked ${result.modifiedCount} properties to your account.`,
      data: {
        propertiesClaimed: result.modifiedCount,
        agentId: currentAgent._id,
        agentName: currentAgent.name,
      },
    });
  } catch (err) {
    console.error(`Claim agent profile error: ${err.message}`);
    next(err);
  }
};

module.exports = {
  createAgentReview,
  getAgentReviews,
  getMyAgentReviews,
  claimAgentProfile,
};