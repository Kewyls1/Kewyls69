require('dotenv').config();
const express = require('express');
const axios = require('axios');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const rateLimit = require('express-rate-limit');
const exphbs = require('express-handlebars');
const app = express();
const path = require('path');
const qs = require('qs');

// Konfiguracja stałych
const BASE_URL = 'https://kewyls69.onrender.com';
const EXCHANGE_RATE = parseFloat(process.env.EXCHANGE_RATE) || 4.3;
const MARKUP = parseFloat(process.env.MARKUP) || 2.0;
const FORTNITE_API_KEY = "24a66776-c97e-4d05-94f5-aa6ca073e856";
const LZT_API_URL = process.env.LZT_API_URL;
const LZT_API_URL2 = process.env.LZT_API_URL2;
const HEADERS = {
    'Authorization': `Bearer ${process.env.LZT_API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
};

const arrayWrap = (value) => {
    if (Array.isArray(value)) {
        return value;
    }
    return value ? [value] : [];
};

const cleanParams = (params) => {
    const cleaned = {};
    for (const [key, value] of Object.entries(params)) {
        if (value !== '' && value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)) {
            cleaned[key] = value;
        }
    }
    return cleaned;
};

const createNameToIdMap = (cosmetics) => {
    const map = {};
    cosmetics.forEach(cosmetic => {
        // Usuwamy wszystkie prefixy: CID_, Pickaxe_, EID_, Glider_
        let rawId = cosmetic.id
            .replace(/^(CID_|Pickaxe_|EID_|Glider_)/i, '')
            .toLowerCase();

        // Dodatkowe specyficzne mapowanie dla tańców
        const danceMapping = {
            "lazer blast": "blaster",
            "lasagna dance": "lasagnadance",
            "electro swing": "electro"
        };

        if (cosmetic.type.value === "emote") {
            // Jeśli istnieje specjalne mapowanie, użyj go
            if (danceMapping[cosmetic.name.toLowerCase()]) {
                rawId = danceMapping[cosmetic.name.toLowerCase()];
            }
            // Dodatkowo usuń 'Dance_' jeśli pozostał
            rawId = rawId.replace(/^dance_/i, '');
        }

        map[cosmetic.name.toLowerCase()] = rawId;
    });
    return map;
};

// Konfiguracja Handlebars
app.engine('html', exphbs.engine({
    extname: '.html',
    defaultLayout: false,
    helpers: {
        eq: (a, b) => a === b,
        contains: (arr, val) => arr && arr.includes(val),
        arrayLength: (arr) => arr ? arr.length : 0,
        gt: (a, b) => a > b,
        add: (a, b) => a + b,
        subtract: (a, b) => a - b,
        toLower: (str) => str ? str.toLowerCase() : '',
        formatTimestamp: (timestamp) => {
            if (!timestamp) return "Brak danych";
            return new Date(timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19);
        },
        capitalize: (str) => {
            if (!str) return '';
            return str.charAt(0).toUpperCase() + str.slice(1);
        },
        replace: (str, oldStr, newStr) => str ? str.replace(new RegExp(oldStr, 'gi'), newStr) : ''
    }
}));
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Przekroczono limit prób'
});

const checkoutLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: 'Zbyt wiele prób płatności'
});

// Helper functions
const fetchApiData = async (url, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, { headers: HEADERS });
            return response.data;
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
};

const fetchFortniteCosmetics = async () => {
    try {
        const response = await axios.get("https://fortnite-api.com/v2/cosmetics/br", {
            headers: { Authorization: FORTNITE_API_KEY }
        });
        return response.data.data || [];
    } catch (error) {
        return [];
    }
};

const mapCosmeticsToItems = (items, cosmetics) => {
    const cosmeticsMap = cosmetics.reduce((acc, cosmetic) => {
        const rawId = cosmetic.id.replace(/^(CID_|Pickaxe_|Dance_|Glider_)/i, '').toLowerCase();
        acc[rawId] = cosmetic;
        return acc;
    }, {});

    return items.map(item => {
        ['fortniteSkins', 'fortnitePickaxe', 'fortniteDance', 'fortniteGliders'].forEach(category => {
            if (item[category]) {
                item[category] = item[category].map(entry => {
                    const entryId = entry.id.replace(/^(CID_|Pickaxe_|Dance_|Glider_)/i, '').toLowerCase();
                    return {
                        ...entry,
                        id: entryId,
                        image_url: cosmeticsMap[entryId]?.images?.icon || ''
                    };
                });
            }
        });
        return item;
    });
};

// Routes
app.get('/', apiLimiter, (req, res) => {
    res.render('index');
});

app.route('/market')
    .get(apiLimiter, async (req, res) => {
        try {
            const cosmetics = await fetchFortniteCosmetics();
            const nameToIdMap = createNameToIdMap(cosmetics);

            const filters = {
                'skin[]': arrayWrap(req.query.skin).map(name => nameToIdMap[name.toLowerCase()] || name),
                'pickaxe[]': arrayWrap(req.query.pickaxe).map(name => nameToIdMap[name.toLowerCase()] || name),
                'dance[]': arrayWrap(req.query.dance).map(name => nameToIdMap[name.toLowerCase()] || name),
                'glider[]': arrayWrap(req.query.glider).map(name => nameToIdMap[name.toLowerCase()] || name),
                title: req.query.title || '',
                smin: req.query.smin || '',
                smax: req.query.smax || '',
                price_min: req.query.price_min || '',
                price_max: req.query.price_max || '',
                platform: req.query.platform || '',
                page: req.query.page || 1,
                sort: req.query.sort || 'highlight'
            };

            const cleanedFilters = cleanParams(filters);
            const selected = {
                skins: arrayWrap(filters['skin[]']),
                pickaxes: arrayWrap(filters['pickaxe[]']),
                dances: arrayWrap(filters['dance[]']),
                gliders: arrayWrap(filters['glider[]'])
            };

            const response = await axios.get(LZT_API_URL, {
                headers: HEADERS,
                params: cleanedFilters,
                paramsSerializer: params => qs.stringify(params, { arrayFormat: 'brackets' })
            });

            let accounts = response.data.items.map(account => {
                const usdPrice = parseFloat(account.price) || 0;
                const accountIds = (account.item_ids || []).map(id => id.toLowerCase());

                return {
                    ...account,
                    pln_price: `${(usdPrice * EXCHANGE_RATE * 2).toFixed(2)} PLN`,
                    usd_price: usdPrice,
                    id: account.item_id || "Brak ID",
                    highlight: Object.values(selected).some(selectedCategory => 
                        selectedCategory.some(selectedId => 
                            accountIds.includes(selectedId.toLowerCase())
                        )
                    )
                };
            });

            const sortMethod = cleanedFilters.sort || 'highlight';
            switch (sortMethod) {
                case 'price_asc':
                    accounts.sort((a, b) => a.usd_price - b.usd_price);
                    break;
                case 'price_desc':
                    accounts.sort((a, b) => b.usd_price - a.usd_price);
                    break;
                case 'pln_asc':
                    accounts.sort((a, b) => (a.usd_price * EXCHANGE_RATE) - (b.usd_price * EXCHANGE_RATE));
                    break;
                case 'pln_desc':
                    accounts.sort((a, b) => (b.usd_price * EXCHANGE_RATE) - (a.usd_price * EXCHANGE_RATE));
                    break;
                default:
                    accounts.sort((a, b) => a.highlight === b.highlight ? 0 : a.highlight ? -1 : 1);
            }

            res.render('market', {
                accounts,
                filters: { ...cleanedFilters, sort: sortMethod },
                page: parseInt(cleanedFilters.page) || 1,
                cosmetics,
                selected_skins: selected.skins,
                selected_pickaxes: selected.pickaxes,
                selected_dances: selected.dances,
                selected_gliders: selected.gliders
            });

        } catch (error) {
            console.error('Market GET error:', error);
            res.status(500).render('error', { message: 'Błąd pobierania danych' });
        }
    })
    .post(apiLimiter, async (req, res) => {
        try {
            const formData = req.body;
            const filters = {};
            const cosmetics = await fetchFortniteCosmetics();
            const nameToIdMap = createNameToIdMap(cosmetics);

            const categoryMapping = {
                skins: 'skin[]',
                pickaxes: 'pickaxe[]',
                dances: 'dance[]',
                gliders: 'glider[]'
            };

            Object.entries(categoryMapping).forEach(([formField, apiParam]) => {
                const rawValue = formData[formField] || '';
                const items = rawValue.split(',').filter(i => i.trim());
                if (items.length) {
                    filters[apiParam] = items.map(name => nameToIdMap[name.toLowerCase()] || name);
                }
            });

            const baseFilters = {
                title: formData.title?.trim() || '',
                smin: formData.smin || '',
                smax: formData.smax || '',
                price_min: formData.price_min || '',
                price_max: formData.price_max || '',
                platform: formData.platform || '',
                page: formData.page || 1,
                sort: formData.sort || 'highlight'
            };

            const cleanedFilters = cleanParams({ ...filters, ...baseFilters });
            const query = Object.entries(cleanedFilters)
                .flatMap(([key, val]) => 
                    Array.isArray(val) 
                        ? val.map(v => `${key}=${encodeURIComponent(v)}`) 
                        : `${key}=${encodeURIComponent(val)}`
                )
                .join('&');

            res.redirect(`/market?${query}`);
        } catch (error) {
            console.error('Market POST error:', error);
            res.status(500).render('error', { message: 'Błąd przetwarzania formularza' });
        }
    });
 
// Dodaj przed sekcją error handling
app.get('/regulamin', apiLimiter, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'regulamin.html'));
});

    app.get('/offer/:itemId', apiLimiter, async (req, res) => {
        try {
            const itemId = req.params.itemId;
            const offerData = await fetchApiData(`${LZT_API_URL2}/${itemId}`);
            
            if (!offerData?.item) return res.status(404).render('404');
    
            const cosmetics = await fetchFortniteCosmetics();
            const mappedItem = mapCosmeticsToItems([offerData.item], cosmetics)[0];
            
            // Poprawione przetwarzanie sezonów
            const past_seasons = (mappedItem.fortnitePastSeasons || []).map(season => ({
                seasonNumber: season.season_number || season.seasonNumber,
                seasonLevel: season.season_level || season.seasonLevel,
                battlePass: Boolean(season.battle_pass || season.battlePass || season.battle_pass_status)
            }));
    
            const categories = [
                { 
                    name: 'Skiny', 
                    items: mappedItem.fortniteSkins,
                    count: mappedItem.fortnite_skin_count 
                },
                { 
                    name: 'Kilofy', 
                    items: mappedItem.fortnitePickaxe,
                    count: mappedItem.fortnite_pickaxe_count 
                },
                { 
                    name: 'Tańce', 
                    items: mappedItem.fortniteDance,
                    count: mappedItem.fortnite_dance_count 
                },
                { 
                    name: 'Lotnie', 
                    items: mappedItem.fortniteGliders,
                    count: mappedItem.fortnite_glider_count 
                }
            ];
    
            res.render('offer', {
                item: {
                    ...mappedItem,
                    pln_price: `${(parseFloat(mappedItem.price) * EXCHANGE_RATE * 2).toFixed(2)} PLN`,
                    price_currency: "PLN",
                    market_link: `https://lzt.market/${itemId}/`
                },
                categories: categories.filter(c => c.items && c.items.length),
                transactions: mappedItem.fortniteTransactions || [],
                past_seasons: past_seasons,
                item_id: itemId,
                stripe_public_key: process.env.STRIPE_PUBLIC_KEY
            });
    
        } catch (error) {
            console.error('Offer error:', error);
            res.status(500).render('error', { message: 'Błąd pobierania oferty' });
        }
    });

app.get('/create-checkout-session/:itemId', checkoutLimiter, async (req, res) => {
    try {
        const itemId = req.params.itemId;
        const offerData = await fetchApiData(`${LZT_API_URL2}/${itemId}`);
        
        if (!offerData?.item) return res.status(404).json({ error: 'Nie znaleziono oferty' });

        const usdPrice = parseFloat(offerData.item.price);
        const plnPrice = Math.round(usdPrice * EXCHANGE_RATE * MARKUP * 100);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'blik', 'paypal'],
            line_items: [{
                price_data: {
                    currency: 'pln',
                    product_data: {
                        name: offerData.item.title,
                    },
                    unit_amount: plnPrice,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.BASE_URL}/payment-success/${itemId}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.BASE_URL}/offer/${itemId}`,
            metadata: {
                item_id: itemId,
                item_title: offerData.item.title.substring(0, 50)
            }
        });

        res.json({ id: session.id });

    } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).json({ error: error.message || 'Wewnętrzny błąd serwera' });
    }
});

app.get('/payment-success/:itemId', apiLimiter, async (req, res) => {
    try {
        const sessionId = req.query.session_id;
        const itemId = req.params.itemId;

        if (!sessionId) return res.status(400).render('error', { message: 'Brak ID sesji' });

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status !== 'paid') {
            return res.status(402).render('error', { message: 'Płatność nie została potwierdzona' });
        }

        const confirmResponse = await axios.post(
            `${LZT_API_URL2}/${itemId}/fast-buy`,
            {},
            { headers: HEADERS, timeout: 30000 }
        );

        const responseData = confirmResponse.data;
        if (!responseData.item?.loginData) {
            throw new Error('Brak danych logowania w odpowiedzi');
        }

        const credentials = {
            login: responseData.item.loginData.login || 'Brak danych',
            password: responseData.item.loginData.password || 'Brak danych',
            email_login: responseData.item.emailLoginData?.login || 'Brak danych',
            email_password: responseData.item.emailLoginData?.password || 'Brak danych',
            old_password: responseData.item.emailLoginData?.oldPassword || 'Brak danych'
        };

        const getEmailProvider = (email) => {
            const domain = email.split('@')[1]?.toLowerCase() || '';
            const providers = {
                firstmail: ['firstmail', 'fmlook'],
                rambler: ['rambler', 'ro'],
                outlook: ['outlook', 'live', 'hotmail'],
                'mail.ru': ['mail.ru', 'bk.ru', 'inbox.ru'],
                notletters: ['notletters', 'nlt']
            };
            
            for (const [provider, domains] of Object.entries(providers)) {
                if (domains.some(d => domain.includes(d))) return provider;
            }
            return 'other';
        };

        res.render('payment_success', {
            credentials,
            email_provider: getEmailProvider(credentials.email_login),
            item_details: {
                fortnite_register_date: responseData.item.fortnite_register_date,
                fortnite_last_activity: responseData.item.fortnite_last_activity,
                fortnite_skin_count: responseData.item.fortnite_skin_count
            }
        });

    } catch (error) {
        console.error('Payment success error:', error);
        res.status(500).render('error', { message: 'Błąd przetwarzania płatności' });
    }
});

app.get('/download-credentials', (req, res) => {
    const login = req.query.login || 'Brak danych';
    const password = req.query.password || 'Brak danych';
    const email_login = req.query.email_login || 'Brak danych';
    const email_password = req.query.email_password || 'Brak danych';
    const old_password = req.query.old_password || 'Brak danych';
    const register_date = req.query.register_date || 'Brak danych';
    const last_activity = req.query.last_activity || 'Brak danych';
    const skin_count = req.query.skin_count || 'Brak danych';

    const content = `
Dane konta:
Login: ${login}
Hasło: ${password}

Dane email:
Email: ${email_login}
Hasło do email: ${email_password}
Stare hasło: ${old_password}

Szczegóły konta:
Data rejestracji: ${register_date}
Ostatnia aktywność: ${last_activity}
Liczba skinów: ${skin_count}
    `;

    res.set({
        'Content-Disposition': 'attachment; filename="DuckMarket - konto.txt"',
        'Content-Type': 'text/plain'
    });
    res.send(content);
});

// Error handling
app.use((req, res) => {
    res.status(404).render('404');
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { message: 'Wewnętrzny błąd serwera' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serwer działa na porcie ${PORT}`);
});
