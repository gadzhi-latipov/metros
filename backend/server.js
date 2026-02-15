import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

// Оптимизированные middleware
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
  maxAge: 86400 // Кэширование preflight на 24 часа
}));

app.use(express.json({ limit: '10kb' })); // Ограничение размера

// Оптимизированное хранение (Map для O(1) доступа)
const users = new Map();
const usersByDevice = new Map();
const usersBySession = new Map();

// Добавляем тестовых пользователей
const initData = () => {
  const testUser1 = {
    id: 1,
    name: 'Анна',
    station: 'Площадь Восстания',
    wagon: '2',
    color: 'Красная куртка',
    colorCode: '#dc3545',
    status: 'На станции',
    online: true,
    city: 'spb',
    gender: 'female',
    position: 'Стою у двери',
    mood: 'Хорошее',
    is_waiting: false,
    is_connected: true,
    session_id: 'session_1',
    device_id: 'device_1',
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString()
  };
  
  const testUser2 = {
    id: 2,
    name: 'Михаил',
    station: 'Пушкинская',
    wagon: '5',
    color: 'Синяя куртка',
    colorCode: '#007bff',
    status: 'В вагоне',
    online: true,
    city: 'spb',
    gender: 'male',
    position: 'Читаю',
    mood: 'Сплю',
    is_waiting: false,
    is_connected: true,
    session_id: 'session_2',
    device_id: 'device_2',
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString()
  };
  
  users.set(1, testUser1);
  users.set(2, testUser2);
  usersByDevice.set('device_1', 1);
  usersByDevice.set('device_2', 2);
  usersBySession.set('session_1', 1);
  usersBySession.set('session_2', 2);
};

initData();

// Кэш статистики
let statsCache = {
  moscow: { data: null, time: 0 },
  spb: { data: null, time: 0 }
};

const CACHE_TTL = 5000; // 5 секунд
const INACTIVE_TIMEOUT = 300000; // 5 минут

// Станции
const stations = {
  moscow: [
    'Авиамоторная', 'Автозаводская', 'Академическая', 'Александровский сад', 'Алексеевская',
    'Алтуфьево', 'Аннино', 'Арбатская', 'Аэропорт', 'Бабушкинская',
    'Багратионовская', 'Баррикадная', 'Бауманская', 'Беговая', 'Белорусская',
    'Беляево', 'Бибирево', 'Библиотека им. Ленина', 'Боровицкая', 'Ботанический сад',
    'Братиславская', 'Бульвар Дмитрия Донского', 'Бунинская аллея', 'Варшавская', 'ВДНХ',
    'Владыкино', 'Водный стадион', 'Войковская', 'Волгоградский проспект', 'Волжская',
    'Воробьёвы горы', 'Выставочная', 'Выхино', 'Деловой центр', 'Динамо'
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

// Быстрое вычисление статистики (один проход)
const calculateStats = (city) => {
  const now = Date.now();
  const cacheKey = city;
  
  // Проверка кэша
  if (statsCache[cacheKey].data && now - statsCache[cacheKey].time < CACHE_TTL) {
    return statsCache[cacheKey].data;
  }
  
  const cityStations = stations[city] || stations.spb;
  const stats = {};
  
  // Инициализация
  for (const station of cityStations) {
    stats[station] = { station, waiting: 0, connected: 0 };
  }
  
  let totalWaiting = 0;
  let totalConnected = 0;
  
  // Один проход по пользователям
  for (const user of users.values()) {
    if (!user.online) continue;
    
    if (user.is_waiting && !user.is_connected) {
      totalWaiting++;
    } else if (user.is_connected && user.station) {
      totalConnected++;
      const stationStat = stats[user.station];
      if (stationStat) stationStat.connected++;
    }
  }
  
  const result = {
    stationStats: Object.values(stats),
    totalStats: {
      waiting: totalWaiting,
      connected: totalConnected,
      total: totalWaiting + totalConnected
    }
  };
  
  // Сохраняем в кэш
  statsCache[cacheKey] = { data: result, time: now };
  
  return result;
};

// Очистка неактивных (запускаем раз в минуту)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  
  for (const [id, user] of users.entries()) {
    if (!user.online) continue;
    
    const lastSeen = new Date(user.last_seen || user.created_at || 0).getTime();
    if (now - lastSeen > INACTIVE_TIMEOUT) {
      user.online = false;
      user.is_connected = false;
      user.is_waiting = false;
      changed = true;
    }
  }
  
  if (changed) {
    // Инвалидируем кэш
    statsCache.moscow.time = 0;
    statsCache.spb.time = 0;
  }
}, 60000);

// Middleware логирования (только в development)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.path} - ${Date.now() - start}ms`);
    });
    next();
  });
}

// ========== API ROUTES ==========

// Быстрый GET /api/users
app.get('/api/users', (req, res) => {
  const onlineUsers = [];
  for (const user of users.values()) {
    if (user.online) onlineUsers.push(user);
  }
  res.json(onlineUsers);
});

// Быстрый POST /api/users
app.post('/api/users', (req, res) => {
  const userData = req.body;
  
  if (!userData.name || !userData.device_id) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  
  // Деактивируем старую сессию по device_id
  const existingId = usersByDevice.get(userData.device_id);
  if (existingId) {
    const existing = users.get(existingId);
    if (existing) {
      existing.online = false;
    }
  }
  
  const newUser = {
    id: Date.now(),
    created_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    online: true,
    colorCode: userData.colorCode || ['#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8'][Math.floor(Math.random() * 5)],
    ...userData
  };
  
  users.set(newUser.id, newUser);
  usersByDevice.set(userData.device_id, newUser.id);
  if (userData.session_id) {
    usersBySession.set(userData.session_id, newUser.id);
  }
  
  // Инвалидируем кэш
  statsCache.moscow.time = 0;
  statsCache.spb.time = 0;
  
  res.status(201).json(newUser);
});

// Быстрый GET /api/stations/waiting-room
app.get('/api/stations/waiting-room', (req, res) => {
  const city = req.query.city || 'spb';
  const stats = calculateStats(city);
  res.json(stats);
});

// Быстрый PUT /api/users/:id
app.put('/api/users/:id', (req, res) => {
  const userId = parseInt(req.params.id);
  const user = users.get(userId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const updateData = req.body;
  
  // Обновляем
  Object.assign(user, updateData);
  user.last_seen = new Date().toISOString();
  
  // Обновляем индексы если нужно
  if (updateData.device_id) {
    usersByDevice.set(updateData.device_id, userId);
  }
  if (updateData.session_id) {
    usersBySession.set(updateData.session_id, userId);
  }
  
  // Инвалидируем кэш если изменились важные поля
  if (updateData.station !== undefined || 
      updateData.is_connected !== undefined || 
      updateData.is_waiting !== undefined ||
      updateData.online !== undefined) {
    statsCache.moscow.time = 0;
    statsCache.spb.time = 0;
  }
  
  res.json(user);
});

// Быстрый POST /api/users/:id/ping
app.post('/api/users/:id/ping', (req, res) => {
  const userId = parseInt(req.params.id);
  const user = users.get(userId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  user.last_seen = new Date().toISOString();
  
  if (req.body && Object.keys(req.body).length > 0) {
    Object.assign(user, req.body);
  }
  
  res.json({ success: true });
});

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    stats: {
      users: users.size,
      online: Array.from(users.values()).filter(u => u.online).length
    }
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});