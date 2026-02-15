import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

// Оптимизированный CORS
app.use(cors({
  origin: [
    'https://frommetro.vercel.app',
    'https://metros-git-main-ruslans-projects-c1667076.vercel.app',
    'https://metros-ruslans-projects-c1667076.vercel.app',
    'http://localhost:3000', 
    'http://localhost:5173',
    'https://vk.com',
    'https://vk-apps.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// In-memory хранилище
let users = [];
let nextId = 1;

// Кэш для быстрых ответов
const statsCache = {
  data: null,
  timestamp: 0
};
const CACHE_TTL = 5000; // 5 секунд

// Быстрая очистка неактивных пользователей
const cleanupInactive = () => {
  const now = Date.now();
  const inactiveThreshold = now - 5 * 60 * 1000; // 5 минут
  
  let changed = false;
  
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    if (!user.online) continue;
    
    const lastSeen = new Date(user.last_seen || 0).getTime();
    if (lastSeen < inactiveThreshold) {
      user.online = false;
      user.is_connected = false;
      user.is_waiting = false;
      user.status = 'Оффлайн';
      changed = true;
    }
  }
  
  if (changed) {
    statsCache.timestamp = 0; // Инвалидируем кэш
  }
};

// Запускаем очистку каждые 30 секунд
setInterval(cleanupInactive, 30000);

// Быстрое логирование
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${Date.now() - start}ms`);
  });
  next();
});

// Получение всех пользователей
app.get('/api/users', (req, res) => {
  const onlineUsers = [];
  
  // Быстрый цикл вместо filter
  for (let i = 0; i < users.length; i++) {
    if (users[i].online) {
      onlineUsers.push(users[i]);
    }
  }
  
  res.json(onlineUsers);
});

// Создание пользователя
app.post('/api/users', (req, res) => {
  const userData = req.body;
  
  if (!userData.name || !userData.device_id) {
    return res.status(400).json({ error: 'name and device_id required' });
  }
  
  // Деактивируем старые сессии с этого устройства
  for (let i = 0; i < users.length; i++) {
    if (users[i].device_id === userData.device_id && users[i].online) {
      users[i].online = false;
      users[i].is_connected = false;
      users[i].is_waiting = false;
    }
  }
  
  const newUser = {
    id: nextId++,
    created_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    online: true,
    is_waiting: true,
    is_connected: false,
    colorCode: userData.colorCode || '#007bff',
    ...userData
  };
  
  users.push(newUser);
  statsCache.timestamp = 0; // Инвалидируем кэш
  
  res.status(201).json(newUser);
});

// Обновление пользователя
app.put('/api/users/:id', (req, res) => {
  const userId = parseInt(req.params.id);
  const updateData = req.body;
  
  for (let i = 0; i < users.length; i++) {
    if (users[i].id === userId) {
      users[i] = { 
        ...users[i], 
        ...updateData,
        last_seen: new Date().toISOString()
      };
      
      // Инвалидируем кэш при изменении важных полей
      if (updateData.station !== undefined || 
          updateData.is_connected !== undefined || 
          updateData.is_waiting !== undefined) {
        statsCache.timestamp = 0;
      }
      
      return res.json(users[i]);
    }
  }
  
  res.status(404).json({ error: 'User not found' });
});

// Ping (быстрое обновление last_seen)
app.post('/api/users/:id/ping', (req, res) => {
  const userId = parseInt(req.params.id);
  
  for (let i = 0; i < users.length; i++) {
    if (users[i].id === userId) {
      users[i].last_seen = new Date().toISOString();
      
      if (req.body && Object.keys(req.body).length > 0) {
        users[i] = { ...users[i], ...req.body };
      }
      
      return res.json({ success: true });
    }
  }
  
  res.status(404).json({ error: 'User not found' });
});

// Получение статистики станций (оптимизировано)
app.get('/api/stations/waiting-room', (req, res) => {
  const city = req.query.city || 'spb';
  const now = Date.now();
  
  // Проверяем кэш
  if (statsCache.data && (now - statsCache.timestamp) < CACHE_TTL) {
    return res.json(statsCache.data);
  }
  
  const stations = {
    moscow: [
      'Авиамоторная', 'Автозаводская', 'Академическая', 'Александровский сад', 'Алексеевская',
      'Алтуфьево', 'Аннино', 'Арбатская', 'Аэропорт', 'Бабушкинская'
    ],
    spb: [
      'Адмиралтейская', 'Балтийская', 'Василеостровская', 'Владимирская', 'Гостиный двор',
      'Горьковская', 'Достоевская', 'Елизаровская', 'Звенигородская', 'Кировский завод',
      'Ладожская', 'Лиговский проспект', 'Ломоносовская', 'Маяковская', 'Невский проспект',
      'Обводный канал', 'Озерки', 'Парк Победы', 'Петроградская', 'Площадь Восстания',
      'Площадь Ленина', 'Приморская', 'Пролетарская', 'Проспект Ветеранов', 'Проспект Просвещения',
      'Пушкинская', 'Садовая', 'Сенная площадь', 'Спасская', 'Спортивная',
      'Старая Деревня', 'Технологический институт', 'Фрунзенская', 'Чернышевская', 'Чкаловская'
    ]
  };
  
  const cityStations = stations[city] || stations.spb;
  const stationStats = [];
  let totalWaiting = 0;
  let totalConnected = 0;
  
  // Быстрый подсчет статистики
  for (const station of cityStations) {
    let waiting = 0;
    let connected = 0;
    
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      if (!user.online) continue;
      if (user.station !== station) continue;
      
      if (user.is_waiting && !user.is_connected) {
        waiting++;
      } else if (user.is_connected) {
        connected++;
      }
    }
    
    stationStats.push({
      station,
      waiting,
      connected,
      totalUsers: waiting + connected
    });
    
    totalWaiting += waiting;
    totalConnected += connected;
  }
  
  const result = {
    stationStats,
    totalStats: {
      total_waiting: totalWaiting,
      total_connected: totalConnected,
      total_users: totalWaiting + totalConnected
    }
  };
  
  // Сохраняем в кэш
  statsCache.data = result;
  statsCache.timestamp = now;
  
  res.json(result);
});

// Health check
app.get('/healthz', (req, res) => res.send('OK'));

app.get('/api/health', (req, res) => {
  const online = users.filter(u => u.online).length;
  const connected = users.filter(u => u.is_connected).length;
  const waiting = users.filter(u => u.is_waiting).length;
  
  res.json({ 
    status: 'OK',
    users: { total: users.length, online, connected, waiting },
    cache: statsCache.data ? 'active' : 'empty'
  });
});

// Оптимизированная обработка 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});