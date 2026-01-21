const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static('public'));

// 房间数据存储
const rooms = new Map();
// 玩家数据存储
const players = new Map();

// 生成随机房间ID
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let roomId = '';
  for (let i = 0; i < 6; i++) {
    roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return roomId;
}

// 生成玩家ID
function generatePlayerId() {
  return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 默认头像列表
const defaultAvatars = [
  '😀', '😎', '🤩', '😊', '😁', '🥳', '🤠', '🧐',
  '👨', '👩', '👦', '👧', '👨‍💻', '👩‍💻', '🦸', '🦹'
];

io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);
  
  let currentRoomId = null;
  let currentPlayerId = null;
  
  // 创建房间
  socket.on('create_room', (data) => {
    const { playerName } = data;
    
    // 生成房间ID
    const roomId = generateRoomId();
    
    // 生成玩家ID
    const playerId = generatePlayerId();
    
    // 随机选择头像
    const randomAvatarIndex = Math.floor(Math.random() * defaultAvatars.length);
    const randomAvatar = defaultAvatars[randomAvatarIndex];
    
    // 创建房间
    const room = {
      id: roomId,
      players: [],
      onlinePlayers: {},
      createdAt: Date.now(),
      gameState: 'waiting'
    };
    
    // 创建房主玩家
    const player = {
      id: playerId,
      name: playerName,
      avatar: randomAvatar,
      isOwner: true,
      connected: true
    };
    
    // 保存玩家信息
    players.set(playerId, {
      ...player,
      socketId: socket.id,
      roomId: roomId
    });
    
    // 更新房间在线玩家
    room.onlinePlayers[playerId] = player;
    
    // 保存房间
    rooms.set(roomId, room);
    
    // 更新当前状态
    currentRoomId = roomId;
    currentPlayerId = playerId;
    
    // 加入房间
    socket.join(roomId);
    
    // 发送房间创建成功消息
    socket.emit('room_created', {
      roomId,
      playerId,
      playerName,
      players: room.players,
      onlinePlayers: room.onlinePlayers
    });
    
    console.log(`房间创建: ${roomId}, 玩家: ${playerName}`);
  });
  
  // 加入房间
  socket.on('join_room', (data) => {
    const { roomId, playerName } = data;
    
    // 检查房间是否存在
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('room_error', { message: '房间不存在' });
      return;
    }
    
    // 检查房间是否已满（可选限制）
    if (Object.keys(room.onlinePlayers).length >= 10) {
      socket.emit('room_error', { message: '房间已满' });
      return;
    }
    
    // 生成玩家ID
    const playerId = generatePlayerId();
    
    // 随机选择头像
    const randomAvatarIndex = Math.floor(Math.random() * defaultAvatars.length);
    const randomAvatar = defaultAvatars[randomAvatarIndex];
    
    // 创建玩家
    const player = {
      id: playerId,
      name: playerName,
      avatar: randomAvatar,
      isOwner: false,
      connected: true
    };
    
    // 保存玩家信息
    players.set(playerId, {
      ...player,
      socketId: socket.id,
      roomId: roomId
    });
    
    // 更新房间在线玩家
    room.onlinePlayers[playerId] = player;
    
    // 更新当前状态
    currentRoomId = roomId;
    currentPlayerId = playerId;
    
    // 加入房间
    socket.join(roomId);
    
    // 发送加入成功消息给新玩家
    socket.emit('room_joined', {
      roomId,
      playerId,
      playerName,
      players: room.players,
      onlinePlayers: room.onlinePlayers
    });
    
    // 广播新玩家加入消息给房间内其他玩家
    socket.to(roomId).emit('player_joined', {
      playerId,
      playerName,
      avatar: randomAvatar,
      onlinePlayers: room.onlinePlayers
    });
    
    console.log(`玩家加入: ${playerName} 加入房间: ${roomId}`);
  });
  
  // 离开房间
  socket.on('leave_room', () => {
    if (!currentRoomId || !currentPlayerId) return;
    
    const room = rooms.get(currentRoomId);
    const player = players.get(currentPlayerId);
    
    if (room && player) {
      // 从在线玩家中移除
      delete room.onlinePlayers[currentPlayerId];
      
      // 如果房主离开，转移房主权限
      if (player.isOwner && Object.keys(room.onlinePlayers).length > 0) {
        const newOwnerId = Object.keys(room.onlinePlayers)[0];
        room.onlinePlayers[newOwnerId].isOwner = true;
        
        // 通知新房主
        const newOwnerSocketId = players.get(newOwnerId)?.socketId;
        if (newOwnerSocketId) {
          io.to(newOwnerSocketId).emit('player_left', {
            onlinePlayers: room.onlinePlayers,
            newOwner: true
          });
        }
      }
      
      // 广播玩家离开消息
      socket.to(currentRoomId).emit('player_left', {
        playerId: currentPlayerId,
        playerName: player.name,
        onlinePlayers: room.onlinePlayers
      });
      
      // 如果房间没有玩家了，删除房间
      if (Object.keys(room.onlinePlayers).length === 0) {
        rooms.delete(currentRoomId);
        console.log(`房间删除: ${currentRoomId}`);
      }
      
      // 从玩家列表中移除
      players.delete(currentPlayerId);
      
      // 离开房间
      socket.leave(currentRoomId);
      
      console.log(`玩家离开: ${player.name} 离开房间: ${currentRoomId}`);
    }
    
    // 重置当前状态
    currentRoomId = null;
    currentPlayerId = null;
  });
  
  // 添加玩家（游戏内玩家）
  socket.on('add_player', (playerData) => {
    if (!currentRoomId) return;
    
    const room = rooms.get(currentRoomId);
    if (!room) return;
    
    // 生成游戏玩家ID
    const gamePlayerId = 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const gamePlayer = {
      id: gamePlayerId,
      name: playerData.name,
      score: playerData.score || 100,
      history: playerData.history || [],
      avatar: playerData.avatar
    };
    
    // 添加到房间玩家列表
    room.players.push(gamePlayer);
    
    // 广播给房间内所有玩家
    io.to(currentRoomId).emit('players_update', {
      players: room.players
    });
    
    console.log(`添加游戏玩家: ${gamePlayer.name} 到房间: ${currentRoomId}`);
  });
  
  // 移除玩家（游戏内玩家）
  socket.on('remove_player', (data) => {
    if (!currentRoomId) return;
    
    const room = rooms.get(currentRoomId);
    const player = players.get(currentPlayerId);
    
    if (!room || !player || !player.isOwner) return;
    
    const { playerId } = data;
    
    // 从玩家列表中移除
    room.players = room.players.filter(p => p.id !== playerId);
    
    // 广播给房间内所有玩家
    io.to(currentRoomId).emit('players_update', {
      players: room.players
    });
    
    console.log(`移除游戏玩家: ${playerId} 从房间: ${currentRoomId}`);
  });
  
  // 调整分数
  socket.on('adjust_score', (data) => {
    if (!currentRoomId) return;
    
    const room = rooms.get(currentRoomId);
    if (!room) return;
    
    const { playerId, scoreValue } = data;
    
    // 找到玩家
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    
    // 更新分数
    const player = room.players[playerIndex];
    const oldScore = player.score;
    player.score += scoreValue;
    
    // 添加历史记录
    const historyItem = {
      type: 'adjust',
      change: scoreValue,
      total: player.score,
      timestamp: new Date().toISOString()
    };
    
    player.history = player.history || [];
    player.history.unshift(historyItem);
    
    // 广播分数更新
    io.to(currentRoomId).emit('score_updated', {
      playerId,
      player
    });
    
    console.log(`调整分数: ${player.name} ${scoreValue > 0 ? '+' : ''}${scoreValue}, 新分数: ${player.score}`);
  });
  
  // 转账请求
  socket.on('transfer_request', (data) => {
    if (!currentRoomId) return;
    
    const room = rooms.get(currentRoomId);
    if (!room) return;
    
    const { fromPlayerId, toPlayerId, amount } = data;
    
    // 找到玩家
    const fromPlayer = room.players.find(p => p.id === fromPlayerId);
    const toPlayer = room.players.find(p => p.id === toPlayerId);
    
    if (!fromPlayer || !toPlayer) return;
    
    // 获取接收者的socket ID
    const receiverSocketId = Object.values(players).find(p => 
      p.roomId === currentRoomId && p.name === toPlayer.name
    )?.socketId;
    
    if (receiverSocketId) {
      // 发送转账请求给接收者
      io.to(receiverSocketId).emit('transfer_request', {
        fromPlayerId,
        toPlayerId,
        fromPlayer: fromPlayer.name,
        toPlayer: toPlayer.name,
        amount
      });
      
      console.log(`转账请求: ${fromPlayer.name} 请求从 ${toPlayer.name} 获得 ${amount} 分`);
    }
  });
  
  // 接受请求
  socket.on('accept_request', (data) => {
    if (!currentRoomId) return;
    
    const room = rooms.get(currentRoomId);
    if (!room) return;
    
    const { fromPlayerId, toPlayerId, amount } = data;
    
    // 找到玩家
    const fromPlayer = room.players.find(p => p.id === fromPlayerId);
    const toPlayer = room.players.find(p => p.id === toPlayerId);
    
    if (!fromPlayer || !toPlayer) return;
    
    // 检查分数是否足够
    if (toPlayer.score < amount) {
      socket.emit('room_error', { message: '分数不足' });
      return;
    }
    
    // 执行转账
    fromPlayer.score += amount;
    toPlayer.score -= amount;
    
    // 添加历史记录
    const fromHistoryItem = {
      type: 'transfer_in',
      amount: amount,
      source: toPlayer.name,
      total: fromPlayer.score,
      timestamp: new Date().toISOString()
    };
    
    const toHistoryItem = {
      type: 'transfer_out',
      amount: -amount,
      target: fromPlayer.name,
      total: toPlayer.score,
      timestamp: new Date().toISOString()
    };
    
    fromPlayer.history = fromPlayer.history || [];
    toPlayer.history = toPlayer.history || [];
    
    fromPlayer.history.unshift(fromHistoryItem);
    toPlayer.history.unshift(toHistoryItem);
    
    // 广播转账完成
    io.to(currentRoomId).emit('transfer_completed', {
      fromPlayerId,
      toPlayerId,
      fromPlayer: fromPlayer.name,
      toPlayer: toPlayer.name,
      amount,
      players: room.players
    });
    
    console.log(`转账完成: ${toPlayer.name} 给 ${fromPlayer.name} 转账 ${amount} 分`);
  });
  
  // 拒绝请求
  socket.on('reject_request', (data) => {
    if (!currentRoomId) return;
    
    const room = rooms.get(currentRoomId);
    if (!room) return;
    
    const { fromPlayerId, toPlayerId } = data;
    
    // 找到请求者
    const fromPlayer = room.players.find(p => p.id === fromPlayerId);
    const toPlayer = room.players.find(p => p.id === toPlayerId);
    
    if (!fromPlayer || !toPlayer) return;
    
    // 获取请求者的socket ID
    const requesterSocketId = Object.values(players).find(p => 
      p.roomId === currentRoomId && p.name === fromPlayer.name
    )?.socketId;
    
    if (requesterSocketId) {
      // 通知请求者请求被拒绝
      io.to(requesterSocketId).emit('room_error', { 
        message: `${toPlayer.name} 拒绝了您的请求` 
      });
      
      console.log(`请求拒绝: ${toPlayer.name} 拒绝了 ${fromPlayer.name} 的请求`);
    }
  });
  
  // 新一局
  socket.on('new_round', () => {
    if (!currentRoomId) return;
    
    const room = rooms.get(currentRoomId);
    const player = players.get(currentPlayerId);
    
    if (!room || !player || !player.isOwner) return;
    
    // 重置所有玩家分数为100，但保留历史记录
    room.players.forEach(player => {
      player.score = 100;
    });
    
    // 广播新一局开始
    io.to(currentRoomId).emit('new_round', {
      players: room.players
    });
    
    console.log(`新一局开始: 房间 ${currentRoomId}`);
  });
  
  // 重置游戏
  socket.on('reset_game', () => {
    if (!currentRoomId) return;
    
    const room = rooms.get(currentRoomId);
    const player = players.get(currentPlayerId);
    
    if (!room || !player || !player.isOwner) return;
    
    // 清空所有玩家
    room.players = [];
    
    // 广播游戏重置
    io.to(currentRoomId).emit('game_reset', {
      players: room.players
    });
    
    console.log(`游戏重置: 房间 ${currentRoomId}`);
  });
  
  // 结束游戏
  socket.on('end_game', () => {
    if (!currentRoomId) return;
    
    const room = rooms.get(currentRoomId);
    const player = players.get(currentPlayerId);
    
    if (!room || !player || !player.isOwner) return;
    
    // 广播游戏结束
    io.to(currentRoomId).emit('game_ended', {
      players: room.players
    });
    
    console.log(`游戏结束: 房间 ${currentRoomId}`);
  });
  
  // 断开连接
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    
    if (currentRoomId && currentPlayerId) {
      const room = rooms.get(currentRoomId);
      const player = players.get(currentPlayerId);
      
      if (room && player) {
        // 标记玩家为离线
        if (room.onlinePlayers[currentPlayerId]) {
          room.onlinePlayers[currentPlayerId].connected = false;
          
          // 广播玩家离线
          socket.to(currentRoomId).emit('player_left', {
            playerId: currentPlayerId,
            playerName: player.name,
            onlinePlayers: room.onlinePlayers
          });
          
          // 设置定时器，一段时间后清理离线玩家
          setTimeout(() => {
            if (room && room.onlinePlayers[currentPlayerId] && !room.onlinePlayers[currentPlayerId].connected) {
              delete room.onlinePlayers[currentPlayerId];
              
              // 如果房主离线且还有在线玩家，转移房主
              if (player.isOwner && Object.keys(room.onlinePlayers).length > 0) {
                const newOwnerId = Object.keys(room.onlinePlayers)[0];
                if (room.onlinePlayers[newOwnerId]) {
                  room.onlinePlayers[newOwnerId].isOwner = true;
                  
                  // 通知新房主
                  const newOwnerSocketId = players.get(newOwnerId)?.socketId;
                  if (newOwnerSocketId) {
                    io.to(newOwnerSocketId).emit('player_left', {
                      onlinePlayers: room.onlinePlayers,
                      newOwner: true
                    });
                  }
                }
              }
              
              // 如果房间没有玩家了，删除房间
              if (Object.keys(room.onlinePlayers).length === 0) {
                rooms.delete(currentRoomId);
                console.log(`房间删除: ${currentRoomId}`);
              }
              
              // 从玩家列表中移除
              players.delete(currentPlayerId);
            }
          }, 30000); // 30秒后清理
        }
      }
    }
  });
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    rooms: rooms.size,
    players: players.size
  });
});

// 房间信息端点
app.get('/rooms', (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    playerCount: Object.keys(room.onlinePlayers).length,
    gamePlayers: room.players.length,
    createdAt: room.createdAt
  }));
  
  res.json({ rooms: roomList });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
