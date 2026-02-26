// server.js
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept']
}));

app.use(express.json());

// Добавьте этот middleware для отладки CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin, Accept');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ==================== ОПТИМИЗИРОВАННОЕ ХРАНЕНИЕ С ИНДЕКСАМИ ====================

// Основное хранилище пользователей
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
  },
  {
    id: 2,
    name: 'Михаил',
    station: 'Пушкинская',
    wagon: '5',
    color: 'Синяя куртка',
    colorCode: '#007bff',
    status: 'Сижу читаю в вагоне | Просто наблюдаю',
    timer: "00:00",
    online: true,
    city: 'spb',
    gender: 'male',
    position: 'Сижу читаю в вагоне',
    mood: 'Просто наблюдаю',
    is_waiting: false,
    is_connected: true,
    session_id: 'session_metro_2',
    device_id: 'device_2',
    vk_user_id: null,
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString()
  },
  {
    id: 3,
    name: 'Елена',
    station: 'Василеостровская',
    wagon: '3',
    color: 'Синее пальто',
    colorCode: '#17a2b8',
    status: 'Брожу по станции | Хорошее настроение',
    online: true,
    city: 'spb',
    gender: 'female',
    position: 'Брожу по станции',
    mood: 'Хорошее настроение',
    is_waiting: false,
    is_connected: true,
    session_id: 'session_metro_3',
    device_id: 'device_3',
    vk_user_id: null,
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString()
  },
  {
    id: 4,
    name: 'Дмитрий',
    station: '',
    color: 'Черная куртка',
    colorCode: '#6c757d',
    status: 'В режиме ожидания',
    online: true,
    city: 'spb',
    gender: 'male',
    position: '',
    mood: '',
    is_waiting: true,
    is_connected: false,
    session_id: 'session_metro_4',
    device_id: 'device_4',
    vk_user_id: null,
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString()
  }
];

// Индексы для быстрого доступа (O(1))
const userIndex = new Map(); // индекс по ID
const deviceIndex = new Map(); // индекс по device_id
const stationIndex = new Map(); // индекс по станции

// Функция перестройки индексов
const rebuildIndexes = () => {
  // Очищаем индексы
  userIndex.clear();
  deviceIndex.clear();
  stationIndex.clear();
  
  // Заполняем индексы
  for (let i = 0; i < mockUsers.length; i++) {
    const user = mockUsers[i];
    userIndex.set(user.id, user);
    
    if (user.device_id) {
      deviceIndex.set(user.device_id, user);
    }
    
    if (user.station && user.station !== '' && user.online) {
      if (!stationIndex.has(user.station)) {
        stationIndex.set(user.station, []);
      }
      stationIndex.get(user.station).push(user);
    }
  }
  
  console.log('📊 Индексы перестроены:', {
    users: userIndex.size,
    devices: deviceIndex.size,
    stations: stationIndex.size
  });
};

// Первоначальное построение индексов
rebuildIndexes();

// Кэш для статистики
let statsCache = {
  data: {},
  timestamp: 0,
  TTL: 2000 // 2 секунды кэширования
};

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
    rebuildIndexes();
    statsCache.timestamp = 0; // Инвалидируем кэш
  }
};

// Запускаем очистку каждую минуту
setInterval(cleanupInactiveUsers, 60000);

// Middleware для логирования
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// ==================== API ROUTES ====================

// Получение всех пользователей (с фильтрацией онлайн)
app.get('/api/users', (req, res) => {
  const onlineUsers = mockUsers.filter(user => user.online === true);
  res.json(onlineUsers);
});

// НОВЫЙ ОПТИМИЗИРОВАННЫЙ ЭНДПОИНТ: получение пользователей конкретной станции
app.get('/api/stations/:station/users', (req, res) => {
  try {
    const station = decodeURIComponent(req.params.station);
    console.log(`📡 Запрос пользователей для станции: ${station}`);
    
    // Получаем из индекса (O(1))
    let stationUsers = stationIndex.get(station) || [];
    
    // Фильтруем только онлайн и подключенных
    const filteredUsers = [];
    for (let i = 0; i < stationUsers.length; i++) {
      const user = stationUsers[i];
      if (user.online && user.is_connected) {
        filteredUsers.push(user);
      }
    }
    
    console.log(`📊 Найдено пользователей на станции ${station}: ${filteredUsers.length}`);
    res.json(filteredUsers);
  } catch (error) {
    console.error('Error getting station users:', error);
    res.status(500).json({ error: 'Ошибка получения пользователей станции' });
  }
});

// Создание пользователя
app.post('/api/users', (req, res) => {
  try {
    const userData = req.body;
    
    // Валидация
    if (!userData.name || !userData.device_id) {
      return res.status(400).json({ 
        error: 'Необходимые поля: name, device_id' 
      });
    }
    
    // Деактивируем старые сессии с того же устройства
    const existingUser = deviceIndex.get(userData.device_id);
    if (existingUser) {
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
    }
    
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
    if (newUser.station === undefined) newUser.station = '';
    
    mockUsers.push(newUser);
    
    // Перестраиваем индексы
    rebuildIndexes();
    
    // Инвалидируем кэш статистики
    statsCache.timestamp = 0;
    
    res.status(201).json(newUser);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Ошибка создания пользователя' });
  }
});

// Получение статистики комнаты ожидания (с кэшем)
app.get('/api/stations/waiting-room', (req, res) => {
  try {
    const city = req.query.city || 'spb';
    const cacheKey = `stats_${city}`;
    const now = Date.now();
    
    // Проверяем кэш
    if (statsCache.data[cacheKey] && (now - statsCache.timestamp) < statsCache.TTL) {
      console.log(`📦 Возвращаем кэшированную статистику для ${city}`);
      return res.json(statsCache.data[cacheKey]);
    }
    
    const cityStations = stations[city] || stations.spb;
    const stationStats = [];
    let total_waiting = 0;
    let total_connected = 0;
    
    // Быстрый подсчет через индексы
    for (let i = 0; i < cityStations.length; i++) {
      const station = cityStations[i];
      const stationUsers = stationIndex.get(station) || [];
      
      let waiting = 0;
      let connected = 0;
      
      for (let j = 0; j < stationUsers.length; j++) {
        const user = stationUsers[j];
        if (!user.online) continue;
        
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
      
      total_waiting += waiting;
      total_connected += connected;
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
    
    console.log(`📊 Отправляем свежую статистику для ${city}`);
    res.json(result);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Ошибка получения статистики' });
  }
});

// Ping активности пользователя
app.post('/api/users/:id/ping', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = userIndex.get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Находим индекс пользователя в массиве
    const userIndexInArray = mockUsers.findIndex(u => u.id === userId);
    
    if (userIndexInArray === -1) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const oldStation = mockUsers[userIndexInArray].station;
    mockUsers[userIndexInArray].last_seen = new Date().toISOString();
    
    // Обновляем статус если переданы данные
    if (req.body && Object.keys(req.body).length > 0) {
      mockUsers[userIndexInArray] = { 
        ...mockUsers[userIndexInArray], 
        ...req.body 
      };
      
      // Если изменилась станция, обновляем индексы
      if (req.body.station && req.body.station !== oldStation) {
        rebuildIndexes();
      }
      
      // Инвалидируем кэш если данные изменились
      if (req.body.station || req.body.is_connected !== undefined || req.body.is_waiting !== undefined) {
        statsCache.timestamp = 0;
      }
    }
    
    res.json({ 
      success: true, 
      user: mockUsers[userIndexInArray] 
    });
  } catch (error) {
    console.error('Error pinging user:', error);
    res.status(500).json({ error: 'Ошибка обновления статуса' });
  }
});

// Обновление пользователя
app.put('/api/users/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const userIndexInArray = mockUsers.findIndex(user => user.id === userId);
    
    if (userIndexInArray === -1) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const oldUser = mockUsers[userIndexInArray];
    const updateData = req.body;
    
    // Проверяем, нужно ли инвалидировать кэш
    const shouldInvalidateCache = 
      updateData.station !== undefined || 
      updateData.is_connected !== undefined || 
      updateData.is_waiting !== undefined;
    
    // Обновляем пользователя
    mockUsers[userIndexInArray] = { 
      ...oldUser, 
      ...updateData,
      last_seen: new Date().toISOString()
    };
    
    // Перестраиваем индексы если изменилась станция
    if (updateData.station && updateData.station !== oldUser.station) {
      rebuildIndexes();
    } else if (shouldInvalidateCache) {
      // Просто обновляем индекс пользователя
      userIndex.set(userId, mockUsers[userIndexInArray]);
      if (mockUsers[userIndexInArray].device_id) {
        deviceIndex.set(mockUsers[userIndexInArray].device_id, mockUsers[userIndexInArray]);
      }
    }
    
    if (shouldInvalidateCache) {
      statsCache.timestamp = 0;
    }
    
    res.json(mockUsers[userIndexInArray]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Ошибка обновления пользователя' });
  }
});

// Присоединение к станции
app.post('/api/rooms/join-station', (req, res) => {
  try {
    const { station, userId } = req.body;
    
    if (!station || !userId) {
      return res.status(400).json({ 
        error: 'Необходимые поля: station, userId' 
      });
    }
    
    const userIndexInArray = mockUsers.findIndex(user => user.id === parseInt(userId));
    
    if (userIndexInArray === -1) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Обновляем пользователя
    mockUsers[userIndexInArray] = {
      ...mockUsers[userIndexInArray],
      station,
      is_waiting: false,
      is_connected: true,
      status: `На станции: ${station}`,
      last_seen: new Date().toISOString()
    };
    
    // Перестраиваем индексы
    rebuildIndexes();
    
    // Возвращаем всех пользователей на этой станции
    const stationUsers = [];
    const stationUsersList = stationIndex.get(station) || [];
    
    for (let i = 0; i < stationUsersList.length; i++) {
      const user = stationUsersList[i];
      if (user.is_connected === true && user.online === true) {
        stationUsers.push(user);
      }
    }
    
    // Инвалидируем кэш
    statsCache.timestamp = 0;
    
    res.json({ 
      success: true,
      users: stationUsers
    });
  } catch (error) {
    console.error('Error joining station:', error);
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
      status: statsCache.timestamp > 0 ? 'active' : 'empty',
      age: statsCache.timestamp > 0 ? Date.now() - statsCache.timestamp : 0,
      ttl: statsCache.TTL
    },
    indexes: {
      userIndex: userIndex.size,
      deviceIndex: deviceIndex.size,
      stationIndex: stationIndex.size
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
  console.log(`💾 Кэш статистики: активен (TTL: ${statsCache.TTL}ms)`);
  console.log(`📊 Индексы: пользователи=${userIndex.size}, устройства=${deviceIndex.size}, станции=${stationIndex.size}`);
  console.log(`👥 Пользователей в памяти: ${mockUsers.length}`);
  console.log(`✅ Доступные маршруты:`);
  console.log(`   GET /api/users`);
  console.log(`   GET /api/stations/:station/users`);
  console.log(`   GET /api/stations/waiting-room`);
  console.log(`   POST /api/users`);
  console.log(`   PUT /api/users/:id`);
  console.log(`   POST /api/users/:id/ping`);
  console.log(`   POST /api/rooms/join-station`);
});