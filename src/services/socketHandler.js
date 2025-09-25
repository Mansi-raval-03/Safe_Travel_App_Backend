const geolib = require('geolib');

// Store active users and their locations
const activeUsers = new Map();
const userRooms = new Map(); // Track which rooms users are in

function socketHandler(io) {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Handle user initialization
    socket.on('user_init', (data) => {
      const { userId, userName } = data;
      
      activeUsers.set(socket.id, {
        id: socket.id,
        userId: userId,
        userName: userName || 'Anonymous User',
        location: null,
        status: 'safe',
        lastSeen: Date.now(),
        connectedAt: Date.now()
      });

      console.log(`User initialized: ${userName} (${userId})`);
    });

    // Handle location updates
    socket.on('location_update', (data) => {
      const user = activeUsers.get(socket.id);
      if (user) {
        user.location = {
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy,
          timestamp: data.timestamp || Date.now(),
          speed: data.speed || 0,
          heading: data.heading || 0
        };
        user.lastSeen = Date.now();

        // Broadcast location to nearby users
        broadcastToNearbyUsers(socket.id, user, 'user_location_updated', {
          userId: user.userId,
          userName: user.userName,
          location: user.location,
          status: user.status
        });

        console.log(`Location updated for ${user.userName}: ${data.latitude}, ${data.longitude}`);
      }
    });

    // Handle emergency alerts
    socket.on('emergency_alert', (data) => {
      const user = activeUsers.get(socket.id);
      if (user && user.location) {
        const alertData = {
          alertId: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          userId: user.userId,
          userName: user.userName,
          alertType: data.alertType,
          message: data.message,
          location: user.location,
          timestamp: data.timestamp || Date.now(),
          additionalData: data.additionalData
        };

        // Update user status
        user.status = 'in_danger';

        // Broadcast emergency alert to nearby users (within 10km)
        broadcastToNearbyUsers(socket.id, user, 'emergency_alert', alertData, 10);

        // Also broadcast to all users in the same rooms
        const userRoomsList = userRooms.get(socket.id) || [];
        userRoomsList.forEach(roomId => {
          socket.to(roomId).emit('emergency_alert', alertData);
        });

        console.log(`Emergency alert from ${user.userName}: ${data.alertType}`);
      }
    });

    // Handle status updates
    socket.on('status_update', (data) => {
      const user = activeUsers.get(socket.id);
      if (user) {
        user.status = data.status;
        user.statusMessage = data.message;
        user.lastSeen = Date.now();

        // Broadcast status update to nearby users
        broadcastToNearbyUsers(socket.id, user, 'user_status_updated', {
          userId: user.userId,
          userName: user.userName,
          status: user.status,
          statusMessage: user.statusMessage,
          timestamp: data.timestamp || Date.now()
        });

        console.log(`Status updated for ${user.userName}: ${data.status}`);
      }
    });

    // Handle nearby users request
    socket.on('request_nearby_users', (data) => {
      const user = activeUsers.get(socket.id);
      if (user && user.location) {
        const nearbyUsers = findNearbyUsers(user, data.radius || 5);
        socket.emit('nearby_users', nearbyUsers);
      }
    });

    // Handle room joining
    socket.on('join_room', (data) => {
      const { roomId } = data;
      socket.join(roomId);
      
      if (!userRooms.has(socket.id)) {
        userRooms.set(socket.id, []);
      }
      userRooms.get(socket.id).push(roomId);
      
      console.log(`User ${socket.id} joined room: ${roomId}`);
    });

    // Handle room leaving
    socket.on('leave_room', (data) => {
      const { roomId } = data;
      socket.leave(roomId);
      
      const rooms = userRooms.get(socket.id) || [];
      const index = rooms.indexOf(roomId);
      if (index > -1) {
        rooms.splice(index, 1);
      }
      
      console.log(`User ${socket.id} left room: ${roomId}`);
    });

    // Handle check-ins
    socket.on('check_in', (data) => {
      const user = activeUsers.get(socket.id);
      if (user && user.location) {
        const checkInData = {
          checkInId: `checkin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          userId: user.userId,
          userName: user.userName,
          location: data.location,
          message: data.message,
          tags: data.tags || [],
          coordinates: user.location,
          timestamp: data.timestamp || Date.now()
        };

        // Broadcast check-in to nearby users
        broadcastToNearbyUsers(socket.id, user, 'user_checked_in', checkInData);

        console.log(`Check-in from ${user.userName} at ${data.location}`);
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      const user = activeUsers.get(socket.id);
      if (user) {
        console.log(`User disconnected: ${user.userName} (${socket.id})`);
        
        // Notify nearby users about disconnection
        broadcastToNearbyUsers(socket.id, user, 'user_disconnected', {
          userId: user.userId,
          userName: user.userName,
          timestamp: Date.now()
        });
      }

      // Clean up
      activeUsers.delete(socket.id);
      userRooms.delete(socket.id);
    });
  });

  // Helper function to find nearby users
  function findNearbyUsers(currentUser, radiusInKm) {
    const nearby = [];
    
    activeUsers.forEach((user, socketId) => {
      if (socketId !== currentUser.id && user.location && currentUser.location) {
        const distance = geolib.getDistance(
          { 
            latitude: currentUser.location.latitude, 
            longitude: currentUser.location.longitude 
          },
          { 
            latitude: user.location.latitude, 
            longitude: user.location.longitude 
          }
        ) / 1000; // Convert to kilometers

        if (distance <= radiusInKm) {
          nearby.push({
            userId: user.userId,
            userName: user.userName,
            location: user.location,
            status: user.status,
            statusMessage: user.statusMessage,
            distance: parseFloat(distance.toFixed(2)),
            lastSeen: user.lastSeen,
            connectedAt: user.connectedAt
          });
        }
      }
    });

    // Sort by distance
    return nearby.sort((a, b) => a.distance - b.distance);
  }

  // Helper function to broadcast to nearby users
  function broadcastToNearbyUsers(senderSocketId, senderUser, eventName, data, radiusInKm = 5) {
    if (!senderUser.location) return;

    activeUsers.forEach((user, socketId) => {
      if (socketId !== senderSocketId && user.location) {
        const distance = geolib.getDistance(
          { 
            latitude: senderUser.location.latitude, 
            longitude: senderUser.location.longitude 
          },
          { 
            latitude: user.location.latitude, 
            longitude: user.location.longitude 
          }
        ) / 1000; // Convert to kilometers

        if (distance <= radiusInKm) {
          io.to(socketId).emit(eventName, data);
        }
      }
    });
  }

  // Periodic cleanup of inactive users (every 5 minutes)
  setInterval(() => {
    const now = Date.now();
    const inactiveThreshold = 10 * 60 * 1000; // 10 minutes

    activeUsers.forEach((user, socketId) => {
      if (now - user.lastSeen > inactiveThreshold) {
        console.log(`Cleaning up inactive user: ${user.userName}`);
        activeUsers.delete(socketId);
        userRooms.delete(socketId);
      }
    });
  }, 5 * 60 * 1000);

  console.log('Socket.IO handler initialized');
}

module.exports = socketHandler;