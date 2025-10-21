// --- ИМПОРТЫ И НАСТРОЙКА ---
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import 'dotenv/config'; // Загружает переменные из .env файла
import { GoogleGenAI, Modality } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

// --- ИНИЦИАЛИЗАЦИЯ ---
const app = express();
const PORT = process.env.PORT || 3001;
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- MIDDLEWARE (Промежуточное ПО для безопасности) ---

// 1. CORS: Разрешаем запросы только с вашего будущего домена и для локальной разработки
const whitelist = ['http://localhost:5173', process.env.CLIENT_URL].filter(Boolean);
const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions));


// 2. Rate Limiter: Ограничиваем количество запросов с одного IP
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 минут
	max: 100, // не более 100 запросов с одного IP за 15 минут
	standardHeaders: true,
	legacyHeaders: false, 
    message: 'Too many requests from this IP, please try again after 15 minutes',
});
app.use('/api/', limiter); // Применяем только к API маршрутам

// 3. JSON Parser: Позволяет серверу читать JSON из тела запроса
app.use(express.json());


// --- API ЭНДПОИНТЫ (Маршруты) ---

// Эндпоинт для чата
app.post('/api/chat', async (req, res) => {
    try {
        const { userInput, systemInstruction } = req.body;

        // Валидация входящих данных
        if (!userInput || typeof userInput !== 'string' || !systemInstruction || typeof systemInstruction !== 'string') {
            return res.status(400).json({ error: 'Invalid input data' });
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: userInput,
            config: { systemInstruction: systemInstruction },
        });
        
        res.json({ aiResponse: response.text });
    } catch (error) {
        console.error('Error in /api/chat:', error);
        res.status(500).json({ error: 'Failed to get response from AI' });
    }
});

// Эндпоинт для AI-задач (Описание, Анализ, Озвучка)
app.post('/api/ai', async (req, res) => {
    try {
        const { task, product, textToSpeak } = req.body;

        if (!task || !product) {
            return res.status(400).json({ error: 'Task and product are required' });
        }

        let result = {};

        switch (task) {
            case 'desc':
                const descResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `Напиши продающее описание для продукта: ${product.name}, Вариант: ${product.variant || 'Standard'}.`,
                    config: { systemInstruction: "Ты эксперт по копирайтингу. Напиши краткое, привлекательное SEO-оптимизированное описание в 2-3 абзацах. Используй сильные, продающие формулировки. Без заголовков и списков." },
                });
                result = { generatedContent: descResponse.text };
                break;
            case 'analysis':
                 const analysisResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `Проведи конкурентный анализ для продукта: ${product.name}. Выдели ключевые отличия.`,
                    config: { tools: [{ googleSearch: {} }], systemInstruction: "Ты аналитик рынка. Выдели 3-4 УТП или сравни с 1-2 аналогами в виде маркированного списка. Без вступлений и заключений." }
                });
                result = { generatedContent: analysisResponse.text };
                break;
            case 'audio':
                 if (!textToSpeak) {
                    return res.status(400).json({ error: 'textToSpeak is required for audio task' });
                 }
                 const audioResponse = await ai.models.generateContent({
                    model: "gemini-2.5-flash-preview-tts",
                    contents: { parts: [{ text: `Скажи профессионально: ${textToSpeak}` }] },
                    config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } }
                });
                const audioPart = audioResponse.candidates?.[0]?.content?.parts?.[0];
                if (audioPart?.inlineData?.data) {
                    result = { audioData: audioPart.inlineData.data };
                } else {
                    throw new Error("Invalid TTS API response format.");
                }
                break;
            default:
                return res.status(400).json({ error: 'Invalid task type' });
        }
        
        res.json(result);

    } catch (error) {
        console.error(`Error in /api/ai for task ${req.body.task}:`, error);
        res.status(500).json({ error: 'Failed to process AI task' });
    }
});

// --- PRODUCTION-READY FRONTEND SERVING ---
if (process.env.NODE_ENV === 'production') {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    // Serve static files from the client build directory
    const clientBuildPath = path.join(__dirname, '../client/dist');
    app.use(express.static(clientBuildPath));
    
    // The "catchall" handler: for any request that doesn't
    // match an API route, send back the client's index.html file.
    app.get('*', (req, res) => {
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    });
}


// --- ЗАПУСК СЕРВЕРА ---
app.listen(PORT, () => {
  console.log(`✅ Server is running securely on http://localhost:${PORT}`);
});