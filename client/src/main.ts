import './style.css';

// --- ТИПЫ И ДАННЫЕ ---

// Глобальные переменные, которые будут заполнены после загрузки данных
let products: any[] = [];
let categories: string[] = [];
let catalogString = '';
let systemInstruction = '';

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}
function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}
function pcmToWav(pcmData: ArrayBuffer, sampleRate = 24000): Blob {
    const buffer = new ArrayBuffer(44 + pcmData.byteLength);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.byteLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, pcmData.byteLength, true);
    new Uint8Array(buffer, 44).set(new Uint8Array(pcmData));
    return new Blob([view], { type: 'audio/wav' });
}

function formatAiResponse(text: string): string {
    let html = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong class="product-link" role="button" tabindex="0">$1</strong>')
        .replace(/(\n|^)\* (.*)/g, '$1<li>$2</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br><ul>/g, '<ul>');
    html = html.replace(/<\/ul><br>/g, '</ul>');
    html = html.replace(/<br><h3>/g, '<h3>');
    html = html.replace(/<\/h3><br>/g, '</h3>');
    return html;
}

function generateWhatsappMessage(product: any): string {
    let priceString;
    if (product.currency === "USD") {
        priceString = `$${product.priceUSD.toLocaleString('en-US')} (~${(product.priceUSD * 450).toLocaleString('ru-RU')} ₸)`;
    } else {
        priceString = `${product.priceKZT.toLocaleString('ru-RU')} ₸`;
    }
    const message = `Здравствуйте!
Хочу заказать следующий товар из вашего магазина MADI ELECTRONICS:
- Товар: ${product.name}
- Вариант: ${product.variant}
- Цена: ${priceString}
- Код товара: ${product.id}
Спасибо!`;
    return encodeURIComponent(message);
}


const Spinner = `<svg class="spinner h-5 w-5 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

// --- ГЛОБАЛЬНОЕ СОСТОЯНИЕ И ПЕРЕМЕННЫЕ ---
let activeFilter = 'All';
let uiState: any = {}; 
let chatMessages: any[] = [];

// --- УПРАВЛЕНИЕ СОСТОЯНИЕМ (localStorage) ---
function loadState() {
    try {
        const persistedUiState = localStorage.getItem('uiState');
        const persistedChatMessages = localStorage.getItem('chatMessages');

        uiState = persistedUiState ? JSON.parse(persistedUiState) : {};
        chatMessages = persistedChatMessages ? JSON.parse(persistedChatMessages) : [{ role: 'ai', text: 'Здравствуйте! Я AI-ассистент. Чем могу помочь с выбором гаджета?' }];

        Object.keys(uiState).forEach(productId => {
            const product = products.find(p => p.id === parseInt(productId));
            if (product && uiState[productId].desc?.generatedContent) {
                product.description = uiState[productId].desc.generatedContent;
            }
        });

    } catch (error) {
        console.error("Failed to load state from localStorage:", error);
        uiState = {};
        chatMessages = [{ role: 'ai', text: 'Здравствуйте! Я AI-ассистент. Чем могу помочь с выбором гаджета?' }];
    }
}

function saveState() {
    try {
        localStorage.setItem('uiState', JSON.stringify(uiState));
        localStorage.setItem('chatMessages', JSON.stringify(chatMessages));
    } catch (error) {
        console.error("Failed to save state to localStorage:", error);
    }
}


// --- DOM ЭЛЕМЕНТЫ ---
const appContainer = document.getElementById('app-container')!;
const preloader = document.getElementById('preloader')!;
const categoryFiltersContainer = document.getElementById('category-filters')!;
const productGrid = document.getElementById('product-grid')!;
const aiModal = document.getElementById('ai-modal')!;
const aiModalTitle = document.getElementById('ai-modal-title')!;
const aiModalBody = document.getElementById('ai-modal-body')!;
const chatFab = document.getElementById('chat-fab')!;
const chatWidget = document.getElementById('chat-widget')!;
const chatCloseBtn = document.getElementById('chat-close-btn')!;
const chatMessagesContainer = document.getElementById('chat-messages')!;
const chatForm = document.getElementById('chat-form')!;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;


// --- ФУНКЦИИ РЕНДЕРИНГА ---
function renderCategories() {
    categoryFiltersContainer.innerHTML = categories.map(cat => 
        `<button data-filter="${cat}" class="btn-category mr-3 last:mr-0 ${activeFilter === cat ? 'active' : ''}">${cat === 'All' ? 'Все товары' : cat}</button>`
    ).join('');
}

function renderProducts() {
    const filteredProducts = activeFilter === 'All' ? products : products.filter(p => p.category === activeFilter);
    productGrid.innerHTML = filteredProducts.map(product => {
        const state = uiState[product.id] || {};
        const isSeoReady = state.desc?.isSeoReady ?? !!product.description;
        const price = product.currency === "USD" ? product.priceUSD : product.priceKZT;
        
        let priceHtml;
        if (price) {
            if (product.currency === "USD") {
                priceHtml = `<span class="text-3xl font-extrabold text-white">$${price.toLocaleString()}</span><span class="text-sm font-semibold text-gray-400 block mt-1">~${(price * 450).toLocaleString('ru-RU')} ₸</span>`;
            } else {
                priceHtml = `<span class="text-3xl font-extrabold text-white">${price.toLocaleString('ru-RU')} ₸</span><span class="text-sm font-semibold text-gray-400 block mt-1">Цена в KZT</span>`;
            }
        } else {
            priceHtml = `<span class="text-xl font-bold text-gray-500">Цена по запросу</span>`;
        }
        
        const whatsappMessage = generateWhatsappMessage(product);

        return `
            <div class="product-card" data-product-id="${product.id}">
                <div class="absolute top-0 left-0 text-white text-xs font-semibold px-3 py-1.5 rounded-tl-xl rounded-br-xl flex items-center shadow-lg ${isSeoReady ? 'bg-emerald-600/80' : 'bg-magenta-600/80'}">
                    SEO: ${isSeoReady ? 'READY' : 'DRAFT'}
                </div>
                ${product.isPreorder ? `<span class="absolute top-0 right-0 bg-magenta-500 text-gray-900 text-xs font-bold px-4 py-2 rounded-tr-xl rounded-bl-xl shadow-lg">ПРЕДЗАКАЗ</span>` : ''}
                
                <div class="relative h-64 bg-gray-900/50 flex items-center justify-center p-4">
                    <img src="${product.image}" loading="lazy" onError="this.onerror=null;this.src='https://placehold.co/600x400/111827/9ca3af?text=Нет+Изображения';" alt="${product.name}" class="max-h-full w-auto object-contain rounded-md" />
                </div>

                <div class="p-6 flex-grow flex flex-col">
                    <div class="flex-grow">
                        <p class="text-xs font-medium text-magenta-400 uppercase tracking-widest mb-2">${product.category}</p>
                        <h2 class="text-2xl font-bold text-gray-50 mb-1 leading-tight">${product.name}</h2>
                        <p class="text-md text-gray-400 mb-4 font-light">${product.variant || ''}</p>
                        <p class="text-sm text-gray-300 italic mb-4 font-light min-h-[40px]">
                            ${product.description || "Краткое описание отсутствует. Требуется AI-генерация."}
                        </p>
                        <div class="mb-6 pt-3 border-t border-gray-700">
                            ${priceHtml}
                        </div>
                    </div>
                    
                    <div class="mt-auto pt-4 border-t border-gray-800">
                        <div class="flex space-x-2 items-center">
                            <div class="relative w-full btn-base-container">
                                <button data-task="desc" class="w-full btn-ai btn-base btn-ai-compact">Описание</button>
                                <span class="ai-tooltip">Создать SEO-описание</span>
                            </div>
                            <div class="relative w-full btn-base-container">
                                <button data-task="analysis" class="w-full btn-analysis btn-base btn-ai-compact">Анализ</button>
                                <span class="ai-tooltip">AI-Анализ Рынка</span>
                            </div>
                            <div class="relative w-full btn-base-container">
                                <button data-task="audio" class="w-full btn-audio btn-base btn-ai-compact">Озвучить</button>
                                <span class="ai-tooltip">Преобразовать в речь</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="p-6 pt-4">
                    <a href="https://wa.me/77012226621?text=${whatsappMessage}" target="_blank" class="block w-full text-center btn-buy btn-base">
                        ${product.isPreorder ? 'Оформить предзаказ' : 'Купить через WhatsApp'}
                    </a>
                </div>
            </div>
        `;
    }).join('');
}

function updateModal(title: string, content: string, type: string) {
    aiModalTitle.textContent = title;
    aiModalTitle.className = `text-2xl font-bold text-gray-50 mb-6 ${type === 'analysis' ? 'text-cyan-400' : type === 'action' ? 'text-white' : 'text-magenta-400'}`;
    aiModalBody.innerHTML = content;

    aiModalBody.classList.remove('action-modal-body', 'p-3', 'rounded-lg', 'min-h-[100px]');
    aiModalBody.classList.add('transition-all', 'duration-300', 'flex', 'items-center', 'justify-center');

    if (type === 'action') {
        aiModalBody.classList.add('action-modal-body');
    } else {
        aiModalBody.classList.add('p-3', 'rounded-lg', 'min-h-[100px]');
    }
}

function renderChatMessages() {
    chatMessagesContainer.innerHTML = '';
    chatMessages.forEach(msg => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${msg.role}`;
        if (msg.role === 'ai') {
            msgDiv.innerHTML = formatAiResponse(msg.text);
        } else {
            msgDiv.textContent = msg.text;
        }
        chatMessagesContainer.appendChild(msgDiv);
    });
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// --- ЛОГИКА ПРИЛОЖЕНИЯ ---
async function handleAITask(productId: number, type: string) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const titles = { desc: '✅ AI: SEO-ОПИСАНИЕ', analysis: '📈 AI: РЫНОЧНЫЙ АНАЛИЗ', audio: '🔊 AI: АУДИОКОНТЕНТ' };
    updateModal(titles[type as keyof typeof titles], `<div class="flex items-center text-lg">${Spinner} Обработка...</div>`, type);
    aiModal.classList.add('open');
    aiModal.style.display = 'flex';

    try {
        const response = await fetch(`/api/ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task: type,
                product: product,
                textToSpeak: uiState[product.id]?.desc?.generatedContent || product.description || `Продукт ${product.name}.`
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка на сервере');
        }

        const result = await response.json();
        
        if (result.generatedContent) {
            updateModal(titles[type as keyof typeof titles], `<div class="max-h-64 overflow-y-auto">${result.generatedContent.replace(/\n/g, '<br>')}</div>`, type);
            if (type === 'desc') {
                if (!uiState[product.id]) uiState[product.id] = {};
                if (!uiState[product.id].desc) uiState[product.id].desc = {};
                uiState[product.id].desc.generatedContent = result.generatedContent;
                uiState[product.id].desc.isSeoReady = true;
                product.description = result.generatedContent;
                renderProductsAndAttachListeners();
                saveState();
            }
        }
        if (result.audioData) {
             const pcmData = base64ToArrayBuffer(result.audioData);
             const wavBlob = pcmToWav(pcmData);
             const audioUrl = URL.createObjectURL(wavBlob);
             updateModal(titles[type as keyof typeof titles], `<audio src="${audioUrl}" controls autoplay class="w-full"></audio>`, type);
        }

    } catch (e) {
        const error = e instanceof Error ? e.message : 'Произошла ошибка';
        updateModal('Ошибка', `Ошибка: ${error}`, 'error');
        aiModalBody.classList.add('bg-red-900/50', 'text-red-300');
    }
}

async function handleSendMessage(e: Event) {
    e.preventDefault();
    const userInput = chatInput.value.trim();
    if (!userInput) return;

    chatMessages.push({ role: 'user', text: userInput });
    renderChatMessages();
    chatInput.value = '';
    chatInput.disabled = true;

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message loading';
    loadingDiv.innerHTML = '<span></span><span></span><span></span>';
    chatMessagesContainer.appendChild(loadingDiv);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

    try {
        const response = await fetch(`/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userInput: userInput,
                systemInstruction: systemInstruction,
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка на сервере');
        }

        const data = await response.json();
        chatMessages.push({ role: 'ai', text: data.aiResponse });

    } catch (error) {
        console.error("Chat error:", error);
        chatMessages.push({ role: 'ai', text: 'Извините, произошла ошибка. Попробуйте еще раз.' });
    } finally {
        chatMessagesContainer.removeChild(loadingDiv);
        renderChatMessages();
        saveState();
        chatInput.disabled = false;
        chatInput.focus();
    }
}


function showProductActionModal(product: any) {
    const whatsappMessage = generateWhatsappMessage(product);
    const whatsappUrl = `https://wa.me/77012226621?text=${whatsappMessage}`;
    
    const content = `
        <div class="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 w-full">
            <button data-product-id-modal="${product.id}" class="modal-action-details-btn w-full btn-base btn-analysis">Подробнее на странице</button>
            <a href="${whatsappUrl}" target="_blank" class="w-full btn-base btn-buy">Заказать в WhatsApp</a>
        </div>
    `;
    updateModal(product.name, content, 'action');
    aiModal.classList.add('open');
    aiModal.style.display = 'flex';
}

function handleDetailsButtonClick(productId: number) {
    closeAiModal();
    setTimeout(() => {
        const productCard = document.querySelector(`.product-card[data-product-id="${productId}"]`);
        if (productCard) {
            productCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            productCard.classList.add('highlighted');
            setTimeout(() => {
                productCard.classList.remove('highlighted');
            }, 1500);
        }
    }, 100);
}

function closeAiModal() {
    aiModal.style.display = 'none';
    aiModal.classList.remove('open');
};

function renderProductsAndAttachListeners() {
    renderProducts();
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const button = (e.target as HTMLElement).closest('button[data-task]');
            if (button) {
                const productId = parseInt((card as HTMLElement).dataset.productId!, 10);
                const taskType = (button as HTMLElement).dataset.task!;
                handleAITask(productId, taskType);
            }
        });
    });
}

// --- ЛОГИКА ИНИЦИАЛИЗАЦИИ ---
async function fetchProducts(): Promise<any[]> {
    try {
        const response = await fetch('/api/products.json'); 
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const strapiResponse = await response.json();
        return strapiResponse.data.map((item: any) => ({
            id: item.id,
            ...item.attributes
        }));
    } catch (error) {
        console.error("Could not fetch products:", error);
        preloader.innerHTML = `
            <div class="text-center text-red-400">
                <h2 class="text-2xl font-bold mb-2">Ошибка загрузки!</h2>
                <p>Не удалось получить каталог товаров. Пожалуйста, попробуйте обновить страницу позже.</p>
            </div>
        `;
        return [];
    }
}

async function initializeApp() {
    const fetchedProducts = await fetchProducts();
    if (fetchedProducts.length === 0) {
        return;
    }
    products = fetchedProducts;
    
    categories = ['All', ...new Set(products.map(p => p.category))].sort();
    catalogString = products.map(p => {
        const price = p.currency === 'USD' ? `${p.priceUSD} USD` : `${p.priceKZT} KZT`;
        return `${p.name} (Категория: ${p.category}) - ${p.variant} - ${price}`;
    }).join('\n');
    systemInstruction = `Ты — дружелюбный и стильный AI-консультант магазина MADI ELECTRONICS. Отвечай на вопросы клиентов, используя ТОЛЬКО следующий список товаров. Не придумывай товары, которых нет в списке. Будь вежлив и краток.

ВАЖНЫЕ ПРАВИЛА ФОРМАТИРОВАНИЯ:
1.  Когда перечисляешь товары, ОБЯЗАТЕЛЬНО используй маркированный список (Markdown). Каждый пункт списка должен быть на новой строке и начинаться со звездочки и пробела ('* ').
2.  Если пользователь запрашивает товары из нескольких категорий, сгруппируй их. Для каждой группы используй заголовок Markdown третьего уровня (###) с эмоджи и названием категории. Например: '### 📱 Смартфоны'.
3.  Выделяй полные названия товаров жирным шрифтом (например, **Samsung Galaxy Z Flip 7**).

Примеры эмоджи для категорий:
- СМАРТФОНЫ: 📱
- УМНЫЕ ОЧКИ: 👓
- APPLE: 💻
- НОСИМЫЕ: ⌚️
- АКСЕССУАРЫ: 🔌
- ДРОНЫ: 🚁
- СВЯЗЬ: 🛰️
- УМНЫЙ ДОМ: 🏠

Формат каждого пункта: "* 📱 **Название** - Вариант - Цена"

Каталог:\n${catalogString}`;

    loadState();
    appContainer.style.display = 'block';
    preloader.style.display = 'none';
    
    renderCategories();
    renderProductsAndAttachListeners();
    renderChatMessages();
    attachEventListeners();
}

function attachEventListeners() {
    categoryFiltersContainer.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON') {
            activeFilter = target.dataset.filter!;
            renderCategories();
            renderProductsAndAttachListeners();
        }
    });

    aiModal.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target === aiModal || target.closest('#ai-modal-close-btn')) {
            closeAiModal();
        }
        const detailsButton = target.closest('.modal-action-details-btn');
        if (detailsButton) {
            const productId = detailsButton.getAttribute('data-product-id-modal');
            if (productId) {
                handleDetailsButtonClick(parseInt(productId, 10));
            }
        }
    });

    chatFab.addEventListener('click', () => chatWidget.classList.toggle('open'));
    chatCloseBtn.addEventListener('click', () => chatWidget.classList.remove('open'));
    chatForm.addEventListener('submit', handleSendMessage);
    
    chatMessagesContainer.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('product-link')) {
            const productName = target.textContent!.trim();
            const product = products.find(p => p.name.trim() === productName);
            if (product) {
                showProductActionModal(product);
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', initializeApp);