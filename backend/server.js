import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
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
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Оптимизированное хранение пользователей в памяти
let mockUsers = [
  {
    id: 1,
    name: 'Анна',
    station: 'Площадь Восстания',
    wagon: '2',
    color: 'Красная куртка',
    colorCode: '#dc3545',
    status: 'Стою у двери в вагоне | Хорошее настроение',
    timer: "00:00",
    online: true,
    city: 'spb',
    gender: 'female',
    position: 'Стою у двери в вагоне',
    mood: 'Хорошее настроение',
    is_waiting: false,
    is_connected: true,
    session_id: 'session_metro_1',
    device_id: 'device_1',
    vk_user_id: null,
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString()
  }
];

// Кэш для оптимизации
let stationCache = {};
let lastCacheUpdate = 0;
const CACHE_TTL = 5000; // 5 секунд

// Список станций
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

// Очистка неактивных пользователей
const cleanupInactiveUsers = () => {
  const now = new Date();
  const inactiveTime = new Date(now.getTime() - 5 * 60 * 1000); // 5 минут
  
  let cleaned = false;
  
  mockUsers = mockUsers.map(user => {
    const lastSeen = new Date(user.last_seen || user.created_at || 0);
    if (lastSeen < inactiveTime && user.online) {
      cleaned = true;
      return {
        ...user,
        online: false,
        is_connected: false,
        is_waiting: false,
        status: 'Оффлайн (неактивность)'
      };
    }
    return user;
  });
  
  if (cleaned) {
    stationCache = {}; // Инвалидируем кэш
  }
};

// Запускаем очистку каждую минуту
setInterval(cleanupInactiveUsers, 60000);

// Оптимизированная функция для получения статистики станций
const getStationStats = (city) => {
  const now = Date.now();
  
  // Проверяем кэш
  const cacheKey = `stats_${city}`;
  if (stationCache[cacheKey] && (now - lastCacheUpdate) < CACHE_TTL) {
    return stationCache[cacheKey];
  }
  
  const cityStations = stations[city] || stations.spb;
  const stationStats = [];
  let total_waiting = 0;
  let total_connected = 0;
  
  // Быстрый подсчет статистики
  for (const station of cityStations) {
    let waiting = 0;
    let connected = 0;
    let totalUsers = 0;
    
    for (const user of mockUsers) {
      if (!user.online) continue;
      if (user.station !== station) continue;
      
      totalUsers++;
      if (user.is_waiting && !user.is_connected) {
        waiting++;
        total_waiting++;
      } else if (user.is_connected) {
        connected++;
        total_connected++;
      }
    }
    
    stationStats.push({
      station,
      waiting,
      connected,
      totalUsers
    });
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
  stationCache[cacheKey] = result;
  lastCacheUpdate = now;
  
  return result;
};

// Middleware для логирования
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// API Routes
app.get('/api/users', (req, res) => {
  const onlineUsers = mockUsers.filter(user => user.online === true);
  res.json(onlineUsers);
});

app.post('/api/users', (req, res) => {
  try {
    const userData = req.body;
    
    // Валидация
    if (!userData.name || !userData.device_id) {
      return res.status(400).json({ 
        error: 'Необходимые поля: name, device_id' 
      });
    }
    
    // Очищаем старые сессии с того же устройства
    mockUsers = mockUsers.map(user => {
      if (user.device_id === userData.device_id && user.online === true) {
        return {
          ...user,
          online: false,
          is_connected: false,
          is_waiting: false,
          status: 'Сессия заменена'
        };
      }
      return user;
    });
    
    const newUser = {
      id: Date.now(),
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      online: true,
      ...userData
    };
    
    // Устанавливаем значения по умолчанию
    if (!newUser.colorCode) {
      const colors = ['#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8'];
      newUser.colorCode = colors[Math.floor(Math.random() * colors.length)];
    }
    
    if (newUser.is_waiting === undefined) newUser.is_waiting = true;
    if (newUser.is_connected === undefined) newUser.is_connected = false;
    
    mockUsers.push(newUser);
    
    // Инвалидируем кэш
    stationCache = {};
    
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка создания пользователя' });
  }
});

app.get('/api/stations/waiting-room', (req, res) => {
  const city = req.query.city || 'spb';
  const stats = getStationStats(city);
  res.json(stats);
});

app.post('/api/users/:id/ping', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const userIndex = mockUsers.findIndex(user => user.id === userId);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    mockUsers[userIndex].last_seen = new Date().toISOString();
    
    // Обновляем статус если переданы данные
    if (req.body && Object.keys(req.body).length > 0) {
      mockUsers[userIndex] = { 
        ...mockUsers[userIndex], 
        ...req.body 
      };
    }
    
    // Инвалидируем кэш если данные изменились
    if (req.body && (req.body.station || req.body.is_connected || req.body.is_waiting)) {
      stationCache = {};
    }
    
    res.json({ 
      success: true, 
      user: mockUsers[userIndex] 
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка обновления статуса' });
  }
});

app.put('/api/users/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const userIndex = mockUsers.findIndex(user => user.id === userId);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const updateData = req.body;
    
    // Проверяем, нужно ли инвалидировать кэш
    const shouldInvalidateCache = 
      updateData.station !== undefined || 
      updateData.is_connected !== undefined || 
      updateData.is_waiting !== undefined;
    
    // Обновляем пользователя
    mockUsers[userIndex] = { 
      ...mockUsers[userIndex], 
      ...updateData,
      last_seen: new Date().toISOString()
    };
    
    if (shouldInvalidateCache) {
      stationCache = {};
    }
    
    res.json(mockUsers[userIndex]);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка обновления пользователя' });
  }
});

app.post('/api/rooms/join-station', (req, res) => {
  try {
    const { station, userId } = req.body;
    
    if (!station || !userId) {
      return res.status(400).json({ 
        error: 'Необходимые поля: station, userId' 
      });
    }
    
    const userIndex = mockUsers.findIndex(user => user.id === parseInt(userId));
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Обновляем пользователя
    mockUsers[userIndex] = {
      ...mockUsers[userIndex],
      station,
      is_waiting: false,
      is_connected: true,
      status: `Выбрал станцию: ${station}`,
      last_seen: new Date().toISOString()
    };
    
    // Возвращаем всех пользователей на этой станции
    const stationUsers = mockUsers.filter(user => 
      user.station === station && 
      user.is_connected === true &&
      user.online === true
    );
    
    // Инвалидируем кэш
    stationCache = {};
    
    res.json({ 
      success: true,
      users: stationUsers
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка присоединения к станции' });
  }
});

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    users: {
      total: mockUsers.length,
      online: mockUsers.filter(u => u.online).length,
      connected: mockUsers.filter(u => u.is_connected).length,
      waiting: mockUsers.filter(u => u.is_waiting).length
    },
    cache: {
      status: Object.keys(stationCache).length > 0 ? 'active' : 'empty',
      stations: Object.keys(stations).length
    }
  });
});

// Обработка OPTIONS запросов для CORS
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Ошибка сервера:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 CORS включен для VK Mini Apps`);
  console.log(`💾 Кэш статистики: активен (TTL: ${CACHE_TTL}ms)`);
  console.log(`👥 Пользователей в памяти: ${mockUsers.length}`);
});