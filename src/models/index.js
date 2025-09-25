const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USERNAME,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

// Import models
const User = require('./User')(sequelize);
const EmergencyContact = require('./EmergencyContact')(sequelize);
const Location = require('./Location')(sequelize);
const SOSAlert = require('./SOSAlert')(sequelize);
const Notification = require('./Notification')(sequelize);
const ContactNotification = require('./ContactNotification')(sequelize);

// Define associations
User.hasMany(EmergencyContact, { foreignKey: 'userId', as: 'emergencyContacts' });
EmergencyContact.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasOne(Location, { foreignKey: 'userId', as: 'location' });
Location.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(SOSAlert, { foreignKey: 'userId', as: 'sosAlerts' });
SOSAlert.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });

SOSAlert.hasMany(ContactNotification, { foreignKey: 'alertId', as: 'contactNotifications' });
ContactNotification.belongsTo(SOSAlert, { foreignKey: 'alertId', as: 'alert' });
ContactNotification.belongsTo(EmergencyContact, { foreignKey: 'contactId', as: 'contact' });

module.exports = {
  sequelize,
  User,
  EmergencyContact,
  Location,
  SOSAlert,
  Notification,
  ContactNotification
};
