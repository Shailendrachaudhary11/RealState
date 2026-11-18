const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Lead = require('../models/Lead');
const Notification = require('../models/Notification');

// Helper to safely delete file from uploads
const safeDeleteFile = (relativeOrFullPath) => {
  if (!relativeOrFullPath) return;
  try {
    const cleanPath = relativeOrFullPath.replace(/^\//, '');
    const absolutePath = path.isAbsolute(relativeOrFullPath)
      ? relativeOrFullPath
      : path.join(__dirname, '..', cleanPath);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (err) {
    console.error(`Failed to delete file (${relativeOrFullPath}): ${err.message}`);
  }
};

const getAllAgentsAdmin = async (req, res, next) => {
  try {
    const {
      search,
      status,
      isActive,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = { role: 'agent' };

    // Search filter across multiple fields
    if (search) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { licenseNumber: searchRegex },
        { liceneseNumber: searchRegex },
      ];
    }

    // Status filter
    if (status) {
      query.status = status;
    }

    // Active/Inactive filter
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }
         
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Fetch agents, total matching count, and aggregate status stats
    const [agents, totalMatching, totalAll, pendingCount, approvedCount, rejectedCount, suspendedCount] =
      await Promise.all([
        User.find(query)
          .select('-password -recentlyViewed -__v')
          .populate("agency", "name")
          .populate("tier", 'tierLevel name description')
          .sort(sortObj)
          .skip(skip)
          .limit(limitNum),
        User.countDocuments(query),
        User.countDocuments({ role: 'agent' }),
        User.countDocuments({ role: 'agent', status: 'pending' }),
        User.countDocuments({ role: 'agent', status: 'approved' }),
        User.countDocuments({ role: 'agent', status: 'rejected' }),
        User.countDocuments({ role: 'agent', status: 'suspended' }),
      ]);


    res.status(200).json({
      success: true,
      message: 'Agents retrieved successfully',
      data: {
        agents,
        stats: {
          total: totalAll,
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
          suspended: suspendedCount,
        },
        pagination: {
          total: totalMatching,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(totalMatching / limitNum) || 1,
        },
      },
    });
  } catch (err) {
    console.error(`Get all agents admin error: ${err.message}`);
    next(err);
  }
};

const getAgentByIdAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error('Invalid Agent ID format');
      error.statusCode = 400;
      return next(error);
    }

    const agent = await User.findOne({ _id: id, role: 'agent' })
      .select('-password -__v -recentlyViewed -refreshToken')
      .populate("tier", 'tierLevel name description')
      .populate("agency")
    if (!agent) {
      const error = new Error('Agent not found');
      error.statusCode = 404;
      return next(error);
    }

    // Fetch leads assigned to this agent
    const leads = await Lead.find({ agent: id })
      .populate('user', 'name email phone profileImage')

      .sort({ createdAt: -1 });

    const agentData = agent.toObject();
    // Normalize license number field
    agentData.licenseNumber = agentData.licenseNumber || agentData.liceneseNumber;
    agentData.liceneseNumber = agentData.liceneseNumber || agentData.licenseNumber;

    res.status(200).json({
      success: true,

      message: 'Agent details retrieved successfully',
      data: {
        agent: agentData,
        leads,
        stats: {
          totalLeads: leads.length,
          pendingLeads: leads.filter((l) => l.status === 'pending').length,
          approvedLeads: leads.filter((l) => l.status === 'approved').length,
          rejectedLeads: leads.filter((l) => l.status === 'rejected').length,
          completedLeads: leads.filter((l) => l.status === 'completed').length,

          // wonLeads: leads.filter((l) => l.status === 'won').length,
          // contactedLeads: leads.filter((l) => l.status === 'contacted').length,
        },
      },
    });
  } catch (err) {
    console.error(`Get agent by ID admin error: ${err.message}`);
    next(err);
  }
};

const updateAgentAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      if (req.file) safeDeleteFile(req.file.path);
      if (req.files) {
        Object.values(req.files).flat().forEach((f) => safeDeleteFile(f.path));
      }
      const error = new Error('Invalid Agent ID format');
      error.statusCode = 400;
      return next(error);
    }
          
    const agent = await User.findOne({ _id: id, role: 'agent' });
    if (!agent) {
      if (req.file) safeDeleteFile(req.file.path);
      if (req.files) {
        Object.values(req.files).flat().forEach((f) => safeDeleteFile(f.path));
      }
      const error = new Error('Agent not found');
      error.statusCode = 404;
      return next(error);
    }

    // Check if new email is provided and already taken by another user
    if (req.body.email) {
      const cleanEmail = req.body.email.toLowerCase().trim();
      if (cleanEmail !== agent.email) {
        const existingEmail = await User.findOne({ email: cleanEmail, _id: { $ne: id } });
        if (existingEmail) {
          if (req.file) safeDeleteFile(req.file.path);
          if (req.files) {
            Object.values(req.files).flat().forEach((f) => safeDeleteFile(f.path));
          }
          const error = new Error('Email is already registered by another user');
          error.statusCode = 400;
          return next(error);
        }
        agent.email = cleanEmail;
      }
    }

    // Handle file uploads (profileImage and document)
    if (req.files) {
      if (req.files.profileImage && req.files.profileImage[0]) {
        if (agent.profileImage) safeDeleteFile(agent.profileImage);
        agent.profileImage = `/uploads/${req.files.profileImage[0].filename}`;
      }
      if (req.files.document && req.files.document[0]) {
        if (agent.document) safeDeleteFile(agent.document);
        agent.document = `/uploads/${req.files.document[0].filename}`;
      }
    } else if (req.file) {
      if (req.file.fieldname === 'profileImage') {
        if (agent.profileImage) safeDeleteFile(agent.profileImage);
        agent.profileImage = `/uploads/${req.file.filename}`;
      } else if (req.file.fieldname === 'document') {
        if (agent.document) safeDeleteFile(agent.document);
        agent.document = `/uploads/${req.file.filename}`;
      }
    }

    // Update body fields if provided
    if (req.body.name) agent.name = req.body.name.trim();
    if (req.body.phone) agent.phone = req.body.phone.trim();
    const incomingAgency = req.body.agency || req.body.agencyId;
    if (incomingAgency !== undefined) agent.agency = incomingAgency || null;

    const newLicense = req.body.licenseNumber || req.body.liceneseNumber;
    if (newLicense !== undefined) {
      agent.licenseNumber = newLicense.trim();
      agent.liceneseNumber = newLicense.trim();
    }

    // Direct document string update (if not uploaded as file)
    if (req.body.document !== undefined && !req.files?.document && req.file?.fieldname !== 'document') {
      agent.document = req.body.document;
    }

    // Direct profileImage string update (if not uploaded as file)
    if (req.body.profileImage !== undefined && !req.files?.profileImage && req.file?.fieldname !== 'profileImage') {
      agent.profileImage = req.body.profileImage;
    }

    const previousStatus = agent.status;

    // Status update
    if (req.body.status) {
      agent.status = req.body.status;
      if (agent.status === 'approved') {
        agent.isActive = true;
      } else if (agent.status === 'suspended') {
        agent.isActive = false;
      }
    }

    // Active toggle
    if (req.body.isActive !== undefined) {
      agent.isActive = req.body.isActive;
    }

    const updatedAgent = await agent.save();

    // Send notification if status changed to approved or rejected
    if (req.body.status && req.body.status !== previousStatus) {
      try {
        if (req.body.status === 'approved') {
          await Notification.create({
            recipient: agent._id,
            sender: req.user?._id || null,
            title: {
              en: 'KYC Approved',
              es: 'KYC Aprobado',
            },
            message: {
              en: 'Congratulations! Your KYC documents have been approved by the administrator. You now have full access as an agent.',
              es: '¡Felicitaciones! Sus documentos de KYC han sido aprobados por el administrador. Ahora tiene acceso completo como asesor.',
            },
            type: 'AGENT_APPROVAL',
            data: {
              metadata: {
                status: 'approved',
              },
            },
          });
        } else if (req.body.status === 'rejected') {
          await Notification.create({
            recipient: agent._id,
            sender: req.user?._id || null,
            title: {
              en: 'KYC Rejected',
              es: 'KYC Rechazado',
            },
            message: {
              en: 'Your KYC documents were rejected by the administrator.',
              es: 'Sus documentos de KYC fueron rechazados por el administrador.',
            },
            type: 'AGENT_APPROVAL',
            data: {
              metadata: {
                status: 'rejected',
              },
            },
          });
        }
      } catch (notifErr) {
        console.error(`Failed to send agent KYC status notification: ${notifErr.message}`);
      }
    }

    const agentData = updatedAgent.toObject();
    delete agentData.password;
    agentData.licenseNumber = agentData.licenseNumber || agentData.liceneseNumber;
    agentData.liceneseNumber = agentData.liceneseNumber || agentData.licenseNumber;

    res.status(200).json({
      success: true,
      message: 'Agent updated successfully',
      data: {
        agent: agentData,
      },
    });
  } catch (err) {
    console.error(`Update agent admin error: ${err.message}`);
    if (req.file) safeDeleteFile(req.file.path);
    if (req.files) {
      Object.values(req.files).flat().forEach((f) => safeDeleteFile(f.path));
    }
    next(err);
  }
};

const changeAgentStatusAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error('Invalid Agent ID format');
      error.statusCode = 400;
      return next(error);
    }

    const agent = await User.findOne({ _id: id, role: 'agent' });
    if (!agent) {
      const error = new Error('Agent not found');
      error.statusCode = 404;
      return next(error);
    }

    const previousStatus = agent.status;

    // Define valid status transitions 
    const validTransitions = {
      'pending': ['approved', 'rejected'],
      'approved': ['suspended'],
      'suspended': ['approved', 'rejected'],
      'rejected': ['pending']
    };

    // Check if transition is valid
    const allowedNextStatuses = validTransitions[previousStatus] || [];
    if (!allowedNextStatuses.includes(status)) {
      let message = 'This status change is not allowed.';

      if (previousStatus === 'pending') {
        message = 'Agent can only be approved or rejected from pending status.';
      } else if (previousStatus === 'approved') {
        message = 'Approved agent can only be suspended.';
      } else if (previousStatus === 'suspended') {
        message = 'Suspended agent can be approved or rejected.';
      } else if (previousStatus === 'rejected') {
        message = 'Rejected agent needs to be sent back to pending for review.';
      }

      const error = new Error(message);
      error.statusCode = 400;
      return next(error);
    }

    agent.status = status;

    // Sync isActive state with status 
    if (status === 'approved') {
      agent.isActive = true;
    } else if (status === 'suspended') {
      agent.isActive = false;
    }

    await agent.save();

    // Send bilingual notification to the agent on KYC approval or rejection
    try {
      if (status === 'approved') {
        await Notification.create({
          recipient: agent._id,
          sender: req.user?._id || null,
          title: {
            en: 'KYC Approved',
            es: 'KYC Aprobado',
          },
          message: {
            en: 'Congratulations! Your KYC documents have been approved by the administrator. You now have full access as an agent.',
            es: '¡Felicitaciones! Sus documentos de KYC han sido aprobados por el administrador. Ahora tiene acceso completo como asesor.',
          },
          type: 'AGENT_APPROVAL',
          data: {
            metadata: {
              status: 'approved',
              reason: reason || null,
            },
          },
        });
      } else if (status === 'rejected') {
        await Notification.create({
          recipient: agent._id,
          sender: req.user?._id || null,
          title: {
            en: 'KYC Rejected',
            es: 'KYC Rechazado',
          },
          message: {
            en: `Your KYC documents were rejected by the administrator.${reason ? ` Reason: ${reason}` : ''}`,
            es: `Sus documentos de KYC fueron rechazados por el administrador.${reason ? ` Razón: ${reason}` : ''}`,
          },
          type: 'AGENT_APPROVAL',
          data: {
            metadata: {
              status: 'rejected',
              reason: reason || null,
            },
          },
        });
      }
    } catch (notifErr) {
      console.error(`Failed to send agent KYC status notification: ${notifErr.message}`);
    }

    res.status(200).json({
      success: true,
      message: `Agent status successfully changed from '${previousStatus || 'pending'}' to '${status}'`,
      data: {
        id: agent._id,
        name: agent.name,
        email: agent.email,
        phone: agent.phone,
        agency: agent.agency,
        status: agent.status,
        isActive: agent.isActive,
        reason: reason || null,
        updatedAt: agent.updatedAt,
      },
    });
  } catch (err) {
    console.error(`Change agent status admin error: ${err.message}`);
    next(err);
  }
};

const deleteAgentAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error('Invalid Agent ID format');
      error.statusCode = 400;
      return next(error);
    }

    const agent = await User.findOne({ _id: id, role: 'agent' });
    if (!agent) {
      const error = new Error('Agent not found');
      error.statusCode = 404;
      return next(error);
    }

    // 1. Delete agent profile image from disk
    if (agent.profileImage) {
      safeDeleteFile(agent.profileImage);
    }

    // 2. Delete agent document from disk
    if (agent.document) {
      safeDeleteFile(agent.document);
    }

    // 3. Remove associated leads assigned to this agent
    await Lead.deleteMany({ agent: id });

    // 4. Remove associated notifications
    await Notification.deleteMany({ $or: [{ recipient: id }, { sender: id }] });

    // 5. Delete agent from DB
    await User.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Agent and all associated records deleted successfully',
      data: {
        id,
        name: agent.name,
        email: agent.email,
        agency: agent.agency,
      },
    });
  } catch (err) {
    console.error(`Delete agent admin error: ${err.message}`);
    next(err);
  }
};

// agency management

module.exports = {
  getAllAgentsAdmin,
  getAgentByIdAdmin,
  updateAgentAdmin,
  changeAgentStatusAdmin,
  deleteAgentAdmin
};