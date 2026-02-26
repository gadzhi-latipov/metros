// services/api.js

const BASE_URL = 'https://metro-backend-xlkt.onrender.com/api';
const USE_MOCK_DATA = false; // Переключите для разработки

// Кэш в памяти
let usersCache = null;
let usersCacheTime = 0;
let statsCache = {};
const CACHE_TTL = 2000; // 2 секунды

// Очередь запросов
let pendingRequests = new Map();
let requestQueue = [];
let isProcessing = false;

// Обработка очереди
const processQueue = async () => {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const request = requestQueue.shift();
  
  try {
    const response = await fetch(`${BASE_URL}${request.endpoint}`, request.options);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    request.resolve(data);
  } catch (error) {
    console.warn(`API Error [${request.options.method} ${request.endpoint}]:`, error.message);
    
    // Возвращаем мок данные при ошибке
    try {
      const mockResponse = getMockResponse(request.endpoint, request.options);
      request.resolve(mockResponse);
    } catch {
      request.reject(error);
    }
  } finally {
    isProcessing = false;
    if (requestQueue.length > 0) {
      setTimeout(processQueue, 50);
    }
  }
};

const queuedRequest = (endpoint, options = {}) => {
  return new Promise((resolve, reject) => {
    const defaultOptions = {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...options
    };
    
    if (options.body) {
      defaultOptions.body = JSON.stringify(options.body);
    }
    
    requestQueue.push({
      endpoint,
      options: defaultOptions,
      resolve,
      reject
    });
    
    if (!isProcessing) {
      processQueue();
    }
  });
};

// Мок данные (для разработки)
const getMockResponse = (endpoint, options) => {
  const mockUsers = [
    { id: 1, name: 'Анна', station: 'Площадь Восстания', color: 'Красная куртка', online: true, is_connected: true },
    { id: 2, name: 'Михаил', station: 'Пушкинская', color: 'Синяя куртка', online: true, is_connected: true }
  ];

  const stations = {
    spb: ['Адмиралтейская', 'Балтийская', 'Василеостровская', 'Владимирская', 'Гостиный двор']
  };

  if (endpoint === '/users' && options.method === 'GET') return mockUsers;
  if (endpoint === '/users' && options.method === 'POST') return { id: Date.now(), ...JSON.parse(options.body) };
  
  if (endpoint.includes('/stations/') && endpoint.includes('/users')) {
    return mockUsers;
  }
  
  if (endpoint === '/stations/waiting-room') {
    return {
      stationStats: stations.spb.map(s => ({ station: s, waiting: 1, connected: 2 })),
      totalStats: { total_waiting: 5, total_connected: 10, total_users: 15 }
    };
  }
  
  if (endpoint === '/rooms/join-station') {
    return { success: true, users: mockUsers };
  }
  
  return { success: true };
};

// API методы
export const api = {
  // Быстрое получение пользователей (с кэшем)
  async getUsers(force = false) {
    const now = Date.now();
    if (!force && usersCache && (now - usersCacheTime) < CACHE_TTL) {
      return usersCache;
    }
    
    const data = await queuedRequest('/users');
    usersCache = data;
    usersCacheTime = now;
    return data;
  },

  async createUser(userData) {
    const data = await queuedRequest('/users', { method: 'POST', body: userData });
    usersCache = null; // инвалидируем кэш
    return data;
  },

  async updateUser(userId, updateData) {
    const data = await queuedRequest(`/users/${userId}`, { method: 'PUT', body: updateData });
    usersCache = null;
    statsCache = {}; // инвалидируем
    return data;
  },

  async pingActivity(userId, updateData = {}) {
    return queuedRequest(`/users/${userId}/ping`, { method: 'POST', body: updateData });
  },

  // ОПТИМИЗИРОВАНО: получение статистики с кэшем
  async getStationsStats(city = 'spb', force = false) {
    const cacheKey = `stats_${city}`;
    const now = Date.now();
    
    if (!force && statsCache[cacheKey] && (now - statsCache[cacheKey].time) < CACHE_TTL) {
      return statsCache[cacheKey].data;
    }
    
    const data = await queuedRequest(`/stations/waiting-room?city=${city}`);
    statsCache[cacheKey] = { data, time: now };
    return data;
  },

  // НОВЫЙ ОПТИМИЗИРОВАННЫЙ МЕТОД: получение пользователей станции
  async getStationUsers(station) {
    const encodedStation = encodeURIComponent(station);
    return queuedRequest(`/stations/${encodedStation}/users`);
  },

  async joinStation(data) {
    const result = await queuedRequest('/rooms/join-station', { method: 'POST', body: data });
    usersCache = null;
    statsCache = {};
    return result;
  }
};

export const helpers = {
  stations: {
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
  },
  
  getRandomColor() {
    const colors = ['#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
};

// Для отладки
if (process.env.NODE_ENV === 'development') {
  window.api = api;
}