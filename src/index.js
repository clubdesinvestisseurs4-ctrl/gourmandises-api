require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');

const app = express();

// CORS manuel — garantit que les headers sont toujours présents, même en cas d'erreur 500
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// Firebase — la clé privée peut contenir des \n littéraux selon la plateforme de déploiement
const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
} catch (e) {
  console.error('Firebase init error:', e.message);
}

const db = admin.firestore();

app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/orders', async (req, res) => {
  try {
    const { itemId, itemName, name, lastName, location, whatsapp } = req.body;

    if (!itemId || !itemName || !name || !lastName || !location || !whatsapp) {
      return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }

    const order = {
      itemId: String(itemId).trim(),
      itemName: String(itemName).trim(),
      name: String(name).trim(),
      lastName: String(lastName).trim(),
      location: String(location).trim(),
      whatsapp: String(whatsapp).trim(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('orders').add(order);
    res.status(201).json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('POST /api/orders error:', error);
    res.status(500).json({ error: 'Erreur serveur. Veuillez réessayer.' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const snapshot = await db.collection('orders').orderBy('createdAt', 'desc').get();

    const orders = [];
    const byItem = {};

    snapshot.forEach(doc => {
      const data = doc.data();
      const createdAt = data.createdAt?.toDate?.()?.toISOString() ?? null;

      orders.push({
        id: doc.id,
        itemId: data.itemId,
        itemName: data.itemName,
        name: data.name,
        lastName: data.lastName,
        location: data.location,
        whatsapp: data.whatsapp,
        createdAt,
      });

      if (!byItem[data.itemId]) {
        byItem[data.itemId] = { itemName: data.itemName, count: 0 };
      }
      byItem[data.itemId].count++;
    });

    res.json({ total: orders.length, byItem, orders });
  } catch (error) {
    console.error('GET /api/stats error:', error);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Gourmandises Africaines API — port ${PORT}`);
});
