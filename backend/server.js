// server.js
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

// Оптимизированное хранение с индексами
let mockUsers = [];
const userIndex = new Map(); // index by id
const deviceIndex = new Map(); // index by device_id
const stationIndex = new Map(); // index by station

// Инициализация тестовых данных
const initTestData = () => {
  const testUsers = [
    {
      id: 1,
      name: 'Анна',
      station: 'Площадь Восстания',
      wagon: '2',
      color: 'Красная куртка',
      colorCode: '#dc3545',
      status: 'Стою у двери в вагоне | Хорошее настроение',
      online: true,
      city: 'spb',
      gender: 'female',
      position: 'Стою у двери в вагоне',
      mood: 'Хорошее настроение',
      is_waiting: false,
      is_connected: true,
      session_id: 'session_1',
      device_id: 'device_1',
      vk_user_id: null,
      last_seen: new Date().toISOString(),
      created_at: new Date().toISOString()
    },
    {
      id: 2,
      name: 'Михаил',
      station: 'Пушкинская',
      wagon: '5',
      color: 'Синяя куртка',
      colorCode: '#007bff',
      status: 'Сижу читаю в вагоне | Просто наблюдаю',
      online: true,
      city: 'spb',
      gender: 'male',
      position: 'Сижу читаю в вагоне',
      mood: 'Просто наблюдаю',
      is_waiting: false,
      is_connected: true,
      session_id: 'session_2',
      device_id: 'device_2',
      vk_user_id: null,
      last_seen: new Date().toISOString(),
      created_at: new Date().toISOString()
    }
  ];
  
  mockUsers = testUsers;
  rebuildIndexes();
};

const rebuildIndexes = () => {
  userIndex.clear();
  deviceIndex.clear();
  stationIndex.clear();
  
  mockUsers.forEach(user => {
    userIndex.set(user.id, user);
    if (user.device_id) deviceIndex.set(user.device_id, user);
    if (user.station) {
      if (!stationIndex.has(user.station)) stationIndex.set(user.station, []);
      stationIndex.get(user.station).push(user);
    }
  });
};

// Список станций
const stations = {
  moscow: [
    'Авиамоторная', 'Автозаводская', 'Академическая', 'Александровский сад', 'Алексеевская',
    'Алтуфьево', 'Аннино', 'Арбатская', 'Аэропорт', 'Бабушкинская',
    'Багратионовская', 'Баррикадная', 'Бауманская', 'Беговая', 'Белорусская',
    'Беляево', 'Бибирево', 'Библиотека им. Ленина', 'Боровицкая', 'Ботанический сад'
  ],
  spb: [
    'Адмиралтейская', 'Балтийская', 'Василеостровская', 'Владимирская', 'Гостиный двор',
    'Горьковская', 'Достоевская', 'Елизаровская', 'Звенигородская', 'Кировский завод',
    'Ладожская', 'Лиговский проспект', 'Ломоносовская', 'Маяковская', 'Невский проспект',
    'Обводный канал', 'Озерки', 'Парк Победы', 'Петроградская', 'Площадь Восстания',
    'Площадь Ленина', 'Приморская', 'Пролетарская', 'Проспект Ветеранов', 'Проспект Просвещения',
    'Пушкинская', 'Садовая', 'Сенная площадь', 'Спасская', 'Спортивная'
  ]
};

// Кэш статистики
const statsCache = {
  data: {},
  timestamp: 0,
  TTL: 2000 // 2 секунды
};

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Логирование времени
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${Date.now() - start}ms`);
  });
  next();
});

// ==================== ОПТИМИЗИРОВАННЫЕ API ====================

// Быстрое получение всех пользователей (с кэшем)
app.get('/api/users', (req, res) => {
  const onlineUsers = mockUsers.filter(user => user.online);
  res.json(onlineUsers);
});

// Быстрое получение пользователей станции (ОЧЕНЬ БЫСТРО через индекс)
app.get('/api/stations/:station/users', (req, res) => {
  const station = decodeURIComponent(req.params.station);
  const stationUsers = stationIndex.get(station) || [];
  
  // Фильтруем только онлайн и подключенных
  const onlineUsers = stationUsers.filter(user => user.online && user.is_connected);
  
  res.json(onlineUsers);
});

// Создание пользователя (с обновлением индексов)
app.post('/api/users', (req, res) => {
  try {
    const userData = req.body;
    
    if (!userData.name || !userData.device_id) {
      return res.status(400).json({ error: 'Необходимые поля: name, device_id' });
    }
    
    // Деактивируем старые сессии
    const existingUser = deviceIndex.get(userData.device_id);
    if (existingUser) {
      mockUsers = mockUsers.map(u => 
        u.device_id === userData.device_id ? { ...u, online: false } : u
      );
    }
    
    const newUser = {
      id: Date.now(),
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      online: true,
      is_waiting: true,
      is_connected: false,
      colorCode: ['#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8'][Math.floor(Math.random() * 5)],
      ...userData
    };
    
    mockUsers.push(newUser);
    rebuildIndexes();
    statsCache.timestamp = 0; // инвалидируем кэш
    
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка создания' });
  }
});

// Обновление пользователя (с индексами)
app.put('/api/users/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const userIndex_ = mockUsers.findIndex(u => u.id === userId);
    
    if (userIndex_ === -1) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const oldUser = mockUsers[userIndex_];
    const updateData = req.body;
    
    // Обновляем пользователя
    mockUsers[userIndex_] = {
      ...oldUser,
      ...updateData,
      last_seen: new Date().toISOString()
    };
    
    // Перестраиваем индексы (быстро для небольшого количества)
    rebuildIndexes();
    
    // Инвалидируем кэш если изменились важные поля
    if (updateData.station || updateData.is_connected !== undefined || updateData.is_waiting !== undefined) {
      statsCache.timestamp = 0;
    }
    
    res.json(mockUsers[userIndex_]);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// PING (быстрое обновление last_seen)
app.post('/api/users/:id/ping', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = userIndex.get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Обновляем в массиве (находим по индексу)
    const idx = mockUsers.findIndex(u => u.id === userId);
    if (idx !== -1) {
      mockUsers[idx].last_seen = new Date().toISOString();
      if (req.body && Object.keys(req.body).length > 0) {
        mockUsers[idx] = { ...mockUsers[idx], ...req.body };
        rebuildIndexes();
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка ping' });
  }
});

// Статистика станций (с кэшем)
app.get('/api/stations/waiting-room', (req, res) => {
  try {
    const city = req.query.city || 'spb';
    const cacheKey = `stats_${city}`;
    const now = Date.now();
    
    // Возвращаем из кэша если свежие
    if (statsCache.data[cacheKey] && (now - statsCache.timestamp) < statsCache.TTL) {
      return res.json(statsCache.data[cacheKey]);
    }
    
    const cityStations = stations[city] || stations.spb;
    
    // ОЧЕНЬ БЫСТРЫЙ подсчет через индексы
    const stationStats = cityStations.map(station => {
      const stationUsers = stationIndex.get(station) || [];
      let waiting = 0;
      let connected = 0;
      
      for (const user of stationUsers) {
        if (!user.online) continue;
        if (user.is_waiting) waiting++;
        if (user.is_connected) connected++;
      }
      
      return {
        station,
        waiting,
        connected,
        totalUsers: waiting + connected
      };
    });
    
    // Подсчет тоталов одним проходом
    let total_waiting = 0;
    let total_connected = 0;
    
    for (const user of mockUsers) {
      if (!user.online) continue;
      if (user.is_waiting) total_waiting++;
      if (user.is_connected) total_connected++;
    }
    
    const result = {
      stationStats,
      totalStats: {
        total_waiting,
        total_connected,
        total_users: total_waiting + total_connected
      }
    };
    
    // Сохраняем в кэш
    statsCache.data[cacheKey] = result;
    statsCache.timestamp = now;
    
    res.json(result);
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Ошибка статистики' });
  }
});

// Присоединение к станции
app.post('/api/rooms/join-station', (req, res) => {
  try {
    const { station, userId } = req.body;
    
    if (!station || !userId) {
      return res.status(400).json({ error: 'Необходимые поля: station, userId' });
    }
    
    const user = userIndex.get(parseInt(userId));
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Обновляем пользователя
    const idx = mockUsers.findIndex(u => u.id === parseInt(userId));
    mockUsers[idx] = {
      ...user,
      station,
      is_waiting: false,
      is_connected: true,
      last_seen: new Date().toISOString()
    };
    
    rebuildIndexes();
    statsCache.timestamp = 0;
    
    // Возвращаем пользователей станции
    const stationUsers = (stationIndex.get(station) || [])
      .filter(u => u.online && u.is_connected);
    
    res.json({
      success: true,
      users: stationUsers
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка присоединения' });
  }
});

// Health check
app.get('/healthz', (req, res) => res.send('OK'));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    users: {
      total: mockUsers.length,
      online: mockUsers.filter(u => u.online).length
    },
    cache: {
      age: Date.now() - statsCache.timestamp,
      ttl: statsCache.TTL
    }
  });
});

// Очистка неактивных (каждые 30 секунд)
setInterval(() => {
  const inactiveThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 минут
  let changed = false;
  
  mockUsers = mockUsers.map(user => {
    const lastSeen = new Date(user.last_seen || user.created_at || 0);
    if (lastSeen < inactiveThreshold && user.online) {
      changed = true;
      return { ...user, online: false, is_connected: false, is_waiting: false };
    }
    return user;
  });
  
  if (changed) {
    rebuildIndexes();
    statsCache.timestamp = 0;
  }
}, 30000);

// Инициализация
initTestData();

// Запуск
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📊 Пользователей: ${mockUsers.length}`);
  console.log(`⚡ Кэш TTL: ${statsCache.TTL}ms`);
});