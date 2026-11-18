const languageMappings = require('../config/languageMappings');

/**
 * Resolves the language ('en' or 'es') for the given request.
 * Priority:
 * 1. Logged-in user's preferredLanguage ('spanish'/'es' -> 'es', 'english'/'en' -> 'en')
 * 2. Accept-Language header
 * 3. Query params (lang, langInput, language)
 * 4. Request body (langInput, language, lang)
 * 5. Default fallback to 'en'
 */
const resolveLanguage = (req, userDoc = null) => {
  const targetUser = userDoc || req?.user;
  if (targetUser && targetUser.preferredLanguage) {
    const userPref = targetUser.preferredLanguage.toLowerCase().trim();
    if (userPref === 'spanish' || userPref === 'es') return 'es';
    if (userPref === 'english' || userPref === 'en') return 'en';
  }

  if (req) {
    const rawInput =
      req.query?.lang ||
      req.query?.langInput ||
      req.query?.language ||
      req.body?.langInput ||
      req.body?.preferredLanguage ||
      req.body?.language ||
      req.body?.lang ||
      req.headers?.['accept-language'];

    if (rawInput) {
      const str = rawInput.toString().toLowerCase().trim();
      if (str.includes('spanish') || str === 'es' || str.startsWith('es-')) {
        return 'es';
      }
    }
  }

  return 'en';
};

const formatPropertyData = (propertyDoc, lang = 'en', isFav = false) => {
  if (!propertyDoc) return null;
  const prop = typeof propertyDoc.toObject === 'function' ? propertyDoc.toObject() : { ...propertyDoc };

  prop.isFav = Boolean(isFav);

  if (prop.title) {
    prop.title = prop.title[lang] || prop.title['en'] || prop.title['es'] || '';
  }

  if (prop.description) {
    prop.description = prop.description[lang] || prop.description['en'] || prop.description['es'] || '';
  }

  prop.rawListingType = prop.listingType;
  if (prop.listingType && languageMappings.listingType && languageMappings.listingType[prop.listingType]) {
    prop.listingType = languageMappings.listingType[prop.listingType][lang] || prop.listingType;
  }

  prop.rawPropertyType = prop.propertyType;
  if (prop.propertyType && languageMappings.propertyType && languageMappings.propertyType[prop.propertyType]) {
    prop.propertyType = languageMappings.propertyType[prop.propertyType][lang] || prop.propertyType;
  }

  if (prop.furnishedStatus && languageMappings.furnishedStatus && languageMappings.furnishedStatus[prop.furnishedStatus]) {
    prop.furnishedStatus = languageMappings.furnishedStatus[prop.furnishedStatus][lang] || prop.furnishedStatus;
  }

  if (Array.isArray(prop.amenities) && prop.amenities.length > 0) {
    prop.amenities = prop.amenities.map((amenity) => {
      if (!amenity) return amenity;
      if (typeof amenity === 'object' && amenity.name) {
        return {
          ...amenity,
          name: amenity.name[lang] || amenity.name['en'] || amenity.name['es'] || '',
        };
      }
      return amenity;
    });
  }

  if (prop.agent) {
    const aId = typeof prop.agent === 'object' && prop.agent._id ? prop.agent._id.toString() : prop.agent.toString();
    prop.agentId = aId;
    if (typeof prop.agent === 'object') {
      prop.agent.agentId = aId;

      // SINGLE SOURCE OF TRUTH: Registered agent profile overrides raw scraped snapshot
      const cleanPhone = prop.agent.phone || prop.agentDetails?.phone || '';
      prop.agentDetails = {
        name: prop.agent.name || prop.agentDetails?.name || '',
        phone: cleanPhone,
        email: prop.agent.email || prop.agentDetails?.email || '',
        profileImage: prop.agent.profileImage || prop.agentDetails?.profileImage || null,
        office: (prop.agency && typeof prop.agency === 'object' && prop.agency.name) ? prop.agency.name : (prop.agentDetails?.office || null),
        whatsapp: prop.agent.whatsapp || (cleanPhone ? `https://wa.me/${cleanPhone.replace(/[^0-9]/g, '')}` : (prop.agentDetails?.whatsapp || null)),
        licenseNumber: prop.agent.licenseNumber || null,
        isClaimed: true,
      };
    }
  } else {
    prop.agentId = null;
    if (prop.agentDetails) {
      prop.agentDetails.isClaimed = false;
    }
  }

  return prop;
};

const formatNotificationData = (notificationDoc, lang = 'en') => {
  if (!notificationDoc) return null;
  const notif = typeof notificationDoc.toObject === 'function' ? notificationDoc.toObject() : { ...notificationDoc };

  // Format title
  if (notif.title) {
    if (typeof notif.title === 'object') {
      notif.title = notif.title[lang] || notif.title['en'] || notif.title['es'] || '';
    }
  }

  // Format message
  if (notif.message) {
    if (typeof notif.message === 'object') {
      notif.message = notif.message[lang] || notif.message['en'] || notif.message['es'] || '';
    }
  }

  return notif;
};

// Field translations for Joi validation errors in Spanish
const fieldTranslations = {
  name: 'El nombre',
  email: 'El correo electrónico',
  password: 'La contraseña',
  oldPassword: 'La contraseña anterior',
  newPassword: 'La nueva contraseña',
  confirmPassword: 'La confirmación de contraseña',
  phone: 'El número de teléfono',
  role: 'El rol',
  agencyName: 'El nombre de la agencia',
  licenseNumber: 'El número de licencia',
  liceneseNumber: 'El número de licencia',
  document: 'El documento',
  profileImage: 'La imagen de perfil',
  status: 'El estado',
  isActive: 'El estado activo',
  otp: 'El OTP',
  refreshToken: 'El token de actualización',
  preferredLanguage: 'El idioma preferido',
  language: 'El idioma',
  listingType: 'El tipo de listado',
  propertyType: 'El tipo de propiedad',
  furnishedStatus: 'El estado de amueblado',
  minPrice: 'El precio mínimo',
  maxPrice: 'El precio máximo',
  minSize: 'El tamaño mínimo',
  maxSize: 'El tamaño máximo',
  bedrooms: 'Los dormitorios',
  bathrooms: 'Los baños',
  amenities: 'Las amenidades',
  message: 'El mensaje',
  query: 'La consulta',
  agent: 'El asesor',
};

// Common localized messages dictionary
const messages = {
  // General & Validation
  validationFailed: { en: 'Validation failed', es: 'Error de validación' },
  internalServerError: { en: 'Internal Server Error', es: 'Error interno del servidor' },

  // User Profile & Auth
  userRegistered: { en: 'User registered successfully', es: 'Usuario registrado con éxito' },
  agentRegistered: { en: 'Agent registered successfully. Account is pending approval.', es: 'Asesor registrado con éxito. La cuenta está pendiente de aprobación.' },
  verificationEmailSent: { en: 'Registration successful. A verification link has been sent to your email. Please verify to activate your account.', es: 'Registro exitoso. Se ha enviado un enlace de verificación a su correo electrónico. Por favor verifíquelo para activar su cuenta.' },
  emailVerificationSuccess: { en: 'Email verified successfully! Your account is now approved. You can now log in.', es: '¡Correo verificado con éxito! Su cuenta ya está aprobada. Ya puede iniciar sesión.' },
  invalidOrExpiredVerificationToken: { en: 'Verification link is invalid or has expired. Please request a new verification link.', es: 'El enlace de verificación no es válido o ha caducado. Por favor solicite un nuevo enlace.' },
  emailAlreadyVerified: { en: 'This account has already been verified and approved.', es: 'Esta cuenta ya ha sido verificada y aprobada.' },
  emailExists: { en: 'Email is already registered', es: 'El correo electrónico ya está registrado' },
  loginSuccess: { en: 'Logged in successfully', es: 'Inicio de sesión exitoso' },
  invalidCredentials: { en: 'Invalid email or password', es: 'Correo electrónico o contraseña no válidos' },
  accountDeactivated: { en: 'Account deactivated. Please contact the administrator.', es: 'Cuenta desactivada. Por favor, póngase en contacto con el administrador.' },
  agentPendingApproval: {
    en: 'Agent account is pending approval. Please verify your email to proceed.',
    es: 'La cuenta de asesor está pendiente de aprobación. Por favor, verifique su correo electrónico para continuar.'
  },
  kycPendingApproval: {
    en: 'Your KYC documents are currently under review by admin. Action is restricted until approval.',
    es: 'Sus documentos de KYC están siendo revisados por el administrador. La acción está restringida hasta la aprobación.'
  },
  kycRejectedActionBlocked: {
    en: 'Your KYC documents were rejected. Please update your documents in your profile.',
    es: 'Sus documentos de KYC fueron rechazados. Por favor actualice sus documentos en su perfil.'
  },
  emailVerifiedPendingApproval: {
    en: 'Email verified successfully! Your KYC documents are currently under review by our admin team. You can log in to view the app while your account is pending approval.',
    es: '¡Correo verificado con éxito! Sus documentos de KYC están bajo revisión por nuestro equipo de administración. Puede iniciar sesión para ver la aplicación mientras su cuenta está pendiente de aprobación.'
  },
  emailVerificationRequired: {
    en: 'Please verify your email address before logging in.',
    es: 'Por favor verifique su dirección de correo electrónico antes de iniciar sesión.'
  },
  kycResubmittedSuccess: {
    en: 'KYC documents resubmitted successfully. Your account is now pending admin review.',
    es: 'Documentos de KYC reenviados con éxito. Su cuenta ahora está pendiente de revisión por el administrador.'
  },
  kycDocumentRequired: {
    en: 'Please upload a KYC document',
    es: 'Por favor suba un documento de KYC'
  },
  profileRetrieved: { en: 'Profile retrieved successfully', es: 'Perfil obtenido con éxito' },
  profileUpdated: { en: 'Profile updated successfully', es: 'Perfil actualizado con éxito' },
  passwordChanged: { en: 'Password changed successfully. Please login again with your new password.', es: 'Contraseña cambiada con éxito. Inicie sesión nuevamente con su nueva contraseña.' },
  languageUpdated: { en: 'Language updated successfully', es: 'Idioma actualizado exitosamente' },
  currencyUpdated: { en: 'Currency updated successfully', es: 'Moneda actualizada exitosamente' },
  preferredCurrencyRequired: { en: 'Preferred Currency is required', es: 'La moneda preferida es obligatoria' },
  invalidCurrency: { en: 'Invalid currency. Allowed values are Pesos, Dollar, and Euros', es: 'Moneda no válida. Los valores permitidos son Pesos, Dollar y Euros' },
  agentsRetrieved: { en: 'Agents retrieved successfully', es: 'Agentes obtenidos con éxito' },
  loggedOut: { en: 'Logged out successfully', es: 'Sesión cerrada con éxito' },
  tokenRefreshed: { en: 'Token refreshed successfully', es: 'Token actualizado con éxito' },

  // Auth Middleware
  noTokenProvided: { en: 'Not authorized, no token provided', es: 'No autorizado, no se proporcionó ningún token' },
  tokenFailed: { en: 'Not authorized, token failed', es: 'No autorizado, token no válido o caducado' },
  userNotFound: { en: 'Not authorized, user not found', es: 'No autorizado, usuario no encontrado' },
  accountDeactivatedAuth: { en: 'Not authorized, account is deactivated', es: 'No autorizado, la cuenta está desactivada' },
  adminUnauthorized: { en: 'Not authorized as an admin', es: 'No autorizado como administrador' },
  sessionExpired: { en: 'Invalid refresh token or session has expired. Please login again.', es: 'Token de actualización no válido o la sesión ha caducado. Por favor, inicie sesión nuevamente.' },

  // Password & OTP Errors
  oldPasswordIncorrect: { en: 'Old password does not match', es: 'La contraseña anterior no coincide' },
  newPasswordSameAsOld: { en: 'New password must be different from old password', es: 'La nueva contraseña debe ser diferente de la anterior' },
  emailRequired: { en: 'Please provide email', es: 'Por favor proporcione el correo electrónico' },
  otpSent: { en: 'Password reset OTP sent to your email successfully', es: 'OTP de restablecimiento de contraseña enviado a su correo con éxito' },
  otpVerified: { en: 'OTP verified successfully. You can now reset your password.', es: 'OTP verificado con éxito. Ahora puede restablecer su contraseña.' },
  passwordResetSuccess: { en: 'Password reset successfully. Please login with your new password.', es: 'Contraseña restablecida con éxito. Inicie sesión con su nueva contraseña.' },
  invalidOrExpiredOTP: { en: 'Invalid or expired OTP', es: 'OTP no válido o caducado' },
  otpExpired: { en: 'OTP has expired. Please request a new one.', es: 'El OTP ha caducado. Por favor solicite uno nuevo.' },
  verifyOTPFirst: { en: 'Please verify OTP first', es: 'Por favor verifique el OTP primero' },
  invalidResetToken: { en: 'Invalid reset token. Please request a new OTP.', es: 'Token de restablecimiento no válido. Solicite un nuevo OTP.' },
  passwordMismatch: { en: 'New password and confirm password do not match', es: 'La nueva contraseña y su confirmación no coinciden' },
  otpSentSuccess: { en: 'OTP sent successfully to your email. Valid for 10 minutes.', es: 'OTP enviado con éxito a su correo electrónico. Válido por 10 minutos.' },
  otpVerifiedSuccess: { en: 'OTP verified successfully. You can now reset your password.', es: 'OTP verificado con éxito. Ahora puede restablecer su contraseña.' },
  noAccountWithEmail: { en: 'No account found with this email address', es: 'No se encontró ninguna cuenta con esta dirección de correo electrónico' },
  noOtpRequestFound: { en: 'No OTP request found. Please request an OTP first.', es: 'No se encontró solicitud de OTP. Solicite un OTP primero.' },
  otpExpiredMsg: { en: 'OTP has expired. Please request a new OTP.', es: 'El OTP ha caducado. Por favor solicite un nuevo OTP.' },
  invalidOtpMsg: { en: 'Invalid OTP. Please check the code and try again.', es: 'OTP no válido. Verifique el código e intente nuevamente.' },
  userNotFoundReset: { en: 'User not found or invalid reset request', es: 'Usuario no encontrado o solicitud de restablecimiento no válida' },
  otpVerificationRequired: { en: 'OTP verification required. Please verify OTP first.', es: 'Se requiere verificación de OTP. Por favor verifique el OTP primero.' },
  passwordResetSessionExpired: { en: 'Password reset session expired. Please request a new OTP.', es: 'La sesión de restablecimiento de contraseña ha caducado. Solicite un nuevo OTP.' },
  newAndConfirmRequired: { en: 'New password and confirm password are required', es: 'La nueva contraseña y su confirmación son obligatorias' },
  passwordsDoNotMatch: { en: 'Passwords do not match', es: 'Las contraseñas no coinciden' },
  emailAndOtpRequired: { en: 'Email and OTP are required', es: 'El correo electrónico y el OTP son obligatorios' },

  // Properties
  propertiesRetrieved: { en: 'Properties retrieved successfully', es: 'Propiedades obtenidas con éxito' },
  propertyDetailsRetrieved: { en: 'Property details retrieved successfully', es: 'Detalles de la propiedad obtenidos con éxito' },
  propertyNotFound: { en: 'Property not found', es: 'Propiedad no encontrada' },
  invalidPropertyId: { en: 'Invalid Property ID format', es: 'Formato de ID de propiedad no válido' },
  filterOptionsRetrieved: { en: 'Filter options retrieved successfully', es: 'Opciones de filtro obtenidas con éxito' },
  comparePropertiesRetrieved: { en: 'Properties comparison details retrieved successfully', es: 'Detalles de comparación de propiedades obtenidos con éxito' },
  compareMinTwo: { en: 'Please provide at least two valid property IDs to compare', es: 'Proporcione al menos dos ID de propiedad válidos para comparar' },
  compareMinTwoAlt: { en: 'Please provide at least 2 property IDs to compare', es: 'Proporcione al menos 2 ID de propiedades para comparar' },
  compareMaxFour: { en: 'You can compare up to 4 properties only', es: 'Solo puede comparar hasta 4 propiedades' },
  compareMaxFive: { en: 'You can compare a maximum of 5 properties at a time', es: 'Puede comparar un máximo de 5 propiedades a la vez' },
  compareNotFound: { en: 'None of the specified properties were found', es: 'No se encontró ninguna de las propiedades especificadas' },
  recentlyViewedRetrieved: { en: 'Recently viewed properties retrieved successfully', es: 'Propiedades vistas recientemente obtenidas con éxito' },
  recentlyViewedCleared: { en: 'Recently viewed history cleared successfully', es: 'Historial de propiedades vistas recientemente borrado con éxito' },
  recentlyViewedItemDeleted: { en: 'Recently viewed property removed successfully', es: 'Propiedad vista recientemente eliminada con éxito' },
  recentlyViewedNotFound: { en: 'Property not found in recently viewed history', es: 'Propiedad no encontrada en el historial de vistas recientes' },

  // Favorites
  favoriteAdded: { en: 'Property added to favorites', es: 'Propiedad agregada a favoritos' },
  favoriteRemoved: { en: 'Property removed from favorites', es: 'Propiedad eliminada de favoritos' },
  favoritesRetrieved: { en: 'Favorites retrieved successfully', es: 'Propiedades favoritas obtenidas con éxito' },
  propertyIdRequired: { en: 'Property ID is required', es: 'El ID de la propiedad es obligatorio' },

  // Leads / Inquiries
  leadSent: { en: 'Inquiry sent successfully', es: 'Consulta enviada con éxito' },
  leadsRetrieved: { en: 'Inquiries retrieved successfully', es: 'Consultas obtenidas con éxito' },
  leadRetrieved: { en: 'Inquiry retrieved successfully', es: 'Consulta obtenida con éxito' },
  leadStatusUpdated: { en: 'Inquiry status updated successfully', es: 'Estado de la consulta actualizado con éxito' },
  specifiedAgentNotFound: { en: 'Specified agent is not found or inactive', es: 'El asesor especificado no fue encontrado o está inactivo' },
  leadNotFound: { en: 'Inquiry not found', es: 'Consulta no encontrada' },
  leadNotAuthorized: { en: 'Inquiry not found or you are not authorized to update this inquiry', es: 'Consulta no encontrada o no está autorizado' },
  invalidLeadId: { en: 'Invalid Inquiry ID format', es: 'Formato de ID de consulta no válido' },
  invalidStatusValue: { en: 'Invalid status value', es: 'Valor de estado no válido' },

  // Notifications
  notificationsRetrieved: { en: 'Notifications retrieved successfully', es: 'Notificaciones obtenidas con éxito' },
  notificationRead: { en: 'Notification marked as read', es: 'Notificación marcada como leída' },
  notificationsAllRead: { en: 'All notifications marked as read', es: 'Todas las notificaciones marcadas como leídas' },
  notificationDeleted: { en: 'Notification deleted successfully', es: 'Notificación eliminada con éxito' },
  allNotificationsDeleted: { en: 'All notifications deleted successfully', es: 'Todas las notificaciones eliminadas con éxito' },
  newNotificationsCount: { en: 'New notifications count retrieved', es: 'Conteo de nuevas notificaciones obtenido con éxito' },
  invalidNotificationId: { en: 'Invalid Notification ID format', es: 'Formato de ID de notificación no válido' },
  notificationNotFound: { en: 'Notification not found', es: 'Notificación no encontrada' },

  // Saved Searches
  savedSearchAdded: { en: 'Saved search added successfully', es: 'Búsqueda guardada agregada con éxito' },
  savedSearchesRetrieved: { en: 'Saved searches retrieved successfully', es: 'Búsquedas guardadas obtenidas con éxito' },
  savedSearchDeleted: { en: 'Saved search deleted successfully', es: 'Búsqueda guardada eliminada con éxito' },
  invalidSavedSearchId: { en: 'Invalid saved search ID format', es: 'Formato de ID de búsqueda guardada no válido' },
  savedSearchNotFound: { en: 'Saved search not found', es: 'Búsqueda guardada no encontrada' },

  // Amenities
  amenitiesRetrieved: { en: 'Amenities retrieved successfully', es: 'Amenidades obtenidas con éxito' },
  invalidAmenityId: { en: 'Invalid Amenity ID format', es: 'Formato de ID de amenidad no válido' },
  amenityNotFound: { en: 'Amenity not found', es: 'Amenidad no encontrada' },

  // Agencies
  agenciesRetrieved: { en: 'Agencies retrieved successfully', es: 'Agencias obtenidas con éxito' },
  activeAgenciesRetrieved: { en: 'Active agencies retrieved successfully', es: 'Agencias activas obtenidas con éxito' },
  agencyNotFound: { en: 'Agency not found', es: 'Agencia no encontrada' },
  invalidAgencyId: { en: 'Invalid Agency ID format', es: 'Formato de ID de agencia no válido' },

  // AI & Marketing
  aiSearchSuccess: { en: 'Properties retrieved successfully based on AI search', es: 'Propiedades obtenidas con éxito según la búsqueda de IA' },
  aiSearchNoResults: { en: 'No properties found based on your search', es: 'No se encontraron propiedades según su búsqueda' },
  aiSearchOneResult: { en: '1 property found based on your search', es: '1 propiedad encontrada según su búsqueda' },
  aiHistoryRetrieved: { en: 'Recent AI searches retrieved successfully', es: 'Historial de búsquedas de IA recientes obtenido con éxito' },
  aiHistoryDeleted: { en: 'All AI search history cleared successfully', es: 'Todo el historial de búsqueda de IA ha sido borrado con éxito' },
  aiHistoryItemDeleted: { en: 'AI search history item deleted successfully', es: 'Elemento del historial de búsqueda de IA eliminado con éxito' },
  searchQueryRequired: { en: 'Search query message is required', es: 'El mensaje de consulta de búsqueda es obligatorio' },
  searchHistoryNotFound: { en: 'Search history item not found', es: 'Elemento del historial de búsqueda no encontrado' },
  invalidSearchHistoryId: { en: 'Invalid search history ID format', es: 'Formato de ID de historial de búsqueda no válido' },
  marketingContentGenerated: { en: 'Marketing content generated successfully', es: 'Contenido de marketing generado con éxito' },
  invalidContentType: { en: 'Invalid contentType. Must be instagram, whatsapp, or email', es: 'Tipo de contenido no válido. Debe ser instagram, whatsapp o email' },

  // Common Joi phrases (direct match)
  nameEmpty: { en: 'Name cannot be empty', es: 'El nombre no puede estar vacío' },
  nameMin: { en: 'Name should be at least 2 characters long', es: 'El nombre debe tener al menos 2 caracteres' },
  nameRequired: { en: 'Name is required', es: 'El nombre es obligatorio' },
  emailEmpty: { en: 'Email cannot be empty', es: 'El correo electrónico no puede estar vacío' },
  emailValid: { en: 'Please provide a valid email address', es: 'Por favor proporcione un correo electrónico válido' },
  emailRequiredJoi: { en: 'Email is required', es: 'El correo electrónico es obligatorio' },
  passwordEmpty: { en: 'Password cannot be empty', es: 'La contraseña no puede estar vacía' },
  passwordMin: { en: 'Password must be at least 6 characters long', es: 'La contraseña debe tener al menos 6 caracteres' },
  passwordRequired: { en: 'Password is required', es: 'La contraseña es obligatoria' },
  phoneEmpty: { en: 'Phone number cannot be empty', es: 'El número de teléfono no puede estar vacío' },
  phoneRequired: { en: 'Phone number is required', es: 'El número de teléfono es obligatorio' },
  agencyNameEmpty: { en: 'Agency name cannot be empty', es: 'El nombre de la agencia no puede estar vacío' },
  agencyNameRequired: { en: 'Agency name is required', es: 'El nombre de la agencia es obligatorio' },
  licenseNumberEmpty: { en: 'License number cannot be empty', es: 'El número de licencia no puede estar vacío' },
  licenseNumberRequired: { en: 'License number is required', es: 'El número de licencia es obligatorio' },
  documentEmpty: { en: 'Document cannot be empty', es: 'El documento no puede estar vacío' },
  documentRequired: { en: 'Document is required', es: 'El documento es obligatorio' },
  oldPasswordEmpty: { en: 'Old password cannot be empty', es: 'La contraseña anterior no puede estar vacía' },
  oldPasswordRequired: { en: 'Old password is required', es: 'La contraseña anterior es obligatoria' },
  newPasswordEmpty: { en: 'New password cannot be empty', es: 'La nueva contraseña no puede estar vacía' },
  newPasswordMin: { en: 'New password must be at least 6 characters long', es: 'La nueva contraseña debe tener al menos 6 caracteres' },
  newPasswordRequired: { en: 'New password is required', es: 'La nueva contraseña es obligatoria' },
  confirmPasswordMatch: { en: 'Confirm password must match new password', es: 'La confirmación de la contraseña debe coincidir con la nueva contraseña' },
  confirmPasswordEmpty: { en: 'Confirm password cannot be empty', es: 'La confirmación de contraseña no puede estar vacía' },
  confirmPasswordRequired: { en: 'Confirm password is required', es: 'La confirmación de contraseña es obligatoria' },
  prefLangRequired: { en: 'Preferred language is required (preferredLanguage or language)', es: 'El idioma preferido es obligatorio' },
  langOnly: { en: 'Language must be either english or spanish', es: 'El idioma debe ser english o spanish' },
  agentIdHex: { en: 'Agent ID must be a valid 24-character hexadecimal MongoDB ObjectId', es: 'El ID de asesor debe ser un ObjectId de MongoDB hexadecimal válido de 24 caracteres' },
  agentIdRequired: { en: 'Agent ID is required', es: 'El ID de asesor es obligatorio' },
  listingTypeOnly: { en: 'Listing type must be either RENT or BUY', es: 'El tipo de listado debe ser RENT o BUY' },
  propertyTypeOnly: { en: 'Property type must be APARTMENT, HOUSE, PLOT, or COMMERCIAL', es: 'El tipo de propiedad debe ser APARTMENT, HOUSE, PLOT o COMMERCIAL' },
  furnishedStatusOnly: { en: 'Furnished status must be FULLY_FURNISHED, SEMI_FURNISHED, or UNFURNISHED', es: 'El estado de amueblado debe ser FULLY_FURNISHED, SEMI_FURNISHED o UNFURNISHED' },
  refreshTokenEmpty: { en: 'Refresh token cannot be empty', es: 'El token de actualización no puede estar vacío' },
  refreshTokenRequired: { en: 'Refresh token is required', es: 'El token de actualización es obligatorio' },
  otpEmpty: { en: 'OTP cannot be empty', es: 'El OTP no puede estar vacío' },
  otpLength: { en: 'OTP must be exactly 6 digits', es: 'El OTP debe tener exactamente 6 dígitos' },
  otpRequired: { en: 'OTP is required', es: 'El OTP es obligatorio' },
  statusOnly: { en: 'Status must be one of: pending, approved, rejected, suspended', es: 'El estado debe ser uno de: pending, approved, rejected, suspended' },
  leadStatusOnly: { en: 'Status must be one of: pending, approved, completed, rejected', es: 'El estado debe ser uno de: pending, approved, completed, rejected' },
  invalidLeadStatus: { en: 'Invalid status. Must be one of: pending, approved, completed, rejected', es: 'Estado no válido. Debe ser uno de: pending, approved, completed, rejected' },
  statusRequired: { en: 'Status is required', es: 'El estado es obligatorio' },
  statusEmpty: { en: 'Status cannot be empty', es: 'El estado no puede estar vacío' },
  minPriceNegative: { en: 'minPrice cannot be negative', es: 'El precio mínimo no puede ser negativo' },
  maxPriceNegative: { en: 'maxPrice cannot be negative', es: 'El precio máximo no puede ser negativo' },
  minSizeNegative: { en: 'minSize cannot be negative', es: 'El tamaño mínimo no puede ser negativo' },
  maxSizeNegative: { en: 'maxSize cannot be negative', es: 'El tamaño máximo no puede ser negativo' },
};

/**
 * Resolves a localized string from a key or an existing English message string.
 * Supports both dictionary keys ('userRegistered') and literal English messages ('Invalid email or password').
 */
const getLocalizedMessage = (keyOrText, lang = 'en') => {
  if (!keyOrText) return '';
  const str = keyOrText.toString().trim();
  const normalizedLang = (lang && (lang.toString().toLowerCase().trim() === 'spanish' || lang.toString().toLowerCase().trim() === 'es')) ? 'es' : 'en';

  // If language is English, return English value from dictionary if key exists, else raw string
  if (normalizedLang !== 'es') {
    if (messages[str]) {
      return messages[str].en || str;
    }
    return str;
  }

  // 1. Check exact key match
  if (messages[str] && messages[str].es) {
    return messages[str].es;
  }

  // 2. Check literal English string match across dictionary values
  const lower = str.toLowerCase();
  for (const val of Object.values(messages)) {
    if (val && val.en && val.en.toLowerCase() === lower) {
      return val.es;
    }
  }

  return str;
};

/**
 * Translates a Joi validation error detail into the target language.
 */
const translateJoiError = (detail, lang = 'en') => {
  if (!detail) return '';
  const rawMessage = (detail.message || '').replace(/['"]/g, '');

  if (lang !== 'es') {
    return detail.message || '';
  }

  // 1. Direct dictionary match
  const directMatch = getLocalizedMessage(rawMessage, 'es');
  if (directMatch && directMatch.toLowerCase() !== rawMessage.toLowerCase()) {
    return directMatch;
  }

  // 2. Rule-based translation fallback
  const fieldKey = detail.context?.key || (Array.isArray(detail.path) ? detail.path[0] : null) || detail.context?.label || '';
  const fieldEs = fieldTranslations[fieldKey] || (fieldKey ? `El campo '${fieldKey}'` : 'El campo');

  switch (detail.type) {
    case 'any.required':
      return `${fieldEs} es obligatorio`;
    case 'string.empty':
      return `${fieldEs} no puede estar vacío`;
    case 'string.min':
      return `${fieldEs} debe tener al menos ${detail.context?.limit} caracteres`;
    case 'string.max':
      return `${fieldEs} no puede exceder ${detail.context?.limit} caracteres`;
    case 'string.length':
      return `${fieldEs} debe tener exactamente ${detail.context?.limit} caracteres`;
    case 'string.email':
      return `Por favor proporcione un correo electrónico válido`;
    case 'any.only':
      return `${fieldEs} contiene un valor no válido`;
    case 'number.min':
      return `${fieldEs} no puede ser menor a ${detail.context?.limit}`;
    case 'number.max':
      return `${fieldEs} no puede ser mayor a ${detail.context?.limit}`;
    case 'number.base':
      return `${fieldEs} debe ser un número válido`;
    default:
      return directMatch || detail.message || '';
  }
};

const getSearchResultMessage = (count, lang = 'en') => {
  const isEs = lang === 'es';
  if (count === 0) {
    return isEs
      ? 'No encontramos propiedades que coincidan con tu búsqueda. Puedo ayudarte a encontrar apartamentos, casas, villas, terrenos o locales comerciales según tu presupuesto y ubicación preferida. ¡Intenta buscar en otra zona o ajustar tus filtros!'
      : "We couldn't find any properties matching your search. I can help you find Flats, Villas, Plots, or Commercial shops based on your budget and preferred location. Please try searching in a nearby area or adjusting your filters!";
  }
  if (count === 1) {
    return isEs
      ? '1 propiedad encontrada según su búsqueda'
      : '1 property found based on your search';
  }
  return isEs
    ? `${count} propiedades encontradas según su búsqueda`
    : `${count} properties found based on your search`;
};

module.exports = {
  resolveLanguage,
  formatPropertyData,
  formatNotificationData,
  getLocalizedMessage,
  translateJoiError,
  fieldTranslations,
  messages,
  getSearchResultMessage,
};
