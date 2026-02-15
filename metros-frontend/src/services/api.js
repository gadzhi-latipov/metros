// services/api.js

const BASE_URL = 'https://metro-backend-xlkt.onrender.com/api';
const CACHE_TTL = 30000; // 30 секунд кэш

// Кэш запросов
const requestCache = new Map();

// Очередь запросов
let pendingRequests = [];
let isProcessing = false;

// VKStorage методы
export const storage = {
  async get(key) {
    try {
      const result = await window.bridge?.send("VKWebAppStorageGet", { keys: [key] });
      return result?.keys?.[0]?.value || null;
    } catch {
      return localStorage.getItem(key);
    }
  },
  
  async set(key, value) {
    try {
      await window.bridge?.send("VKWebAppStorageSet", { key, value });
    } catch {
      localStorage.setItem(key, value);
    }
  },
  
  async getKeys(keys) {
    try {
      const result = await window.bridge?.send("VKWebAppStorageGet", { keys });
      return result?.keys || [];
    } catch {
      return keys.map(key => ({ key, value: localStorage.getItem(key) }));
    }
  }
};

// Обработка очереди
const processQueue = async () => {
  if (isProcessing || pendingRequests.length === 0) return;
  
  isProcessing = true;
  const request = pendingRequests.shift();
  
  try {
    const response = await fetch(request.url, request.options);
    const data = await response.json();
    
    // Кэшируем успешные GET запросы
    if (request.options.method === 'GET') {
      requestCache.set(request.url, {
        data,
        timestamp: Date.now()
      });
    }
    
    request.resolve(data);
  } catch (error) {
    // При ошибке пробуем кэш
    const cached = requestCache.get(request.url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      request.resolve(cached.data);
    } else {
      request.reject(error);
    }
  } finally {
    isProcessing = false;
    setTimeout(processQueue, 50); // Минимальная задержка
  }
};

const queueRequest = (endpoint, options = {}) => {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${endpoint}`;
    
    // Проверяем кэш для GET запросов
    if (options.method === 'GET') {
      const cached = requestCache.get(url);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        resolve(cached.data);
        return;
      }
    }
    
    pendingRequests.push({
      url,
      options: {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined
      },
      resolve,
      reject
    });
    
    processQueue();
  });
};

export const api = {
  async getUsers() {
    return queueRequest('/users');
  },

  async createUser(userData) {
    return queueRequest('/users', {
      method: 'POST',
      body: userData
    });
  },

  async updateUser(userId, updateData) {
    return queueRequest(`/users/${userId}`, {
      method: 'PUT',
      body: updateData
    });
  },

  async getStationsStats(city = 'spb') {
    return queueRequest(`/stations/waiting-room?city=${city}&t=${Date.now()}`);
  },

  async joinStation(data) {
    return queueRequest('/rooms/join-station', {
      method: 'POST',
      body: data
    });
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