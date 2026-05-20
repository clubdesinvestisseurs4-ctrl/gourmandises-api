require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const { Resend } = require('resend');

// Firebase — la clé privée peut contenir des \n littéraux selon la plateforme de déploiement
const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;

let db;
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
  db = admin.firestore();
  console.log('Firebase initialisé avec succès.');
} catch (e) {
  console.error('Firebase init error:', e.message);
}

// Resend — envoi via HTTPS (Render bloque SMTP, pas HTTP)
const resend = new Resend(process.env.RESEND_API_KEY);

const sendOrderNotification = async (order) => {
  const notifyEmail = process.env.NOTIFY_EMAIL;
  if (!notifyEmail || !process.env.RESEND_API_KEY) return;

  const date = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });

  const result = await resend.emails.send({
    from: 'CookAfrica <onboarding@resend.dev>',
    to: notifyEmail,
    subject: `Nouvelle demande — ${order.itemName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
        <div style="background: #8B1E1E; padding: 4px 0; background-image: repeating-linear-gradient(90deg, #D4AF37 0px, #D4AF37 20px, #8B1E1E 20px, #8B1E1E 40px);"></div>
        <div style="background: #8B1E1E; padding: 24px; text-align: center;">
          <p style="color: #D4AF37; font-size: 32px; margin: 0; font-weight: 800; letter-spacing: 2px;">COOK</p>
          <p style="color: #F5F5F5; font-size: 22px; margin: 0; font-weight: 800; letter-spacing: 8px;">AFRICA</p>
          <p style="color: #D4AF37; font-size: 11px; margin: 8px 0 0; letter-spacing: 4px; text-transform: uppercase;">Le Restaurant qui Rassemble</p>
        </div>
        <div style="background: #8B1E1E; padding: 4px 0; background-image: repeating-linear-gradient(90deg, #D4AF37 0px, #D4AF37 20px, #8B1E1E 20px, #8B1E1E 40px);"></div>
        <div style="padding: 28px 32px;">
          <h2 style="color: #1f2937; margin-top: 0;">Nouvelle demande de commande</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 10px 0; color: #6b7280; width: 40%;">Plat commandé</td>
              <td style="padding: 10px 0; font-weight: bold; color: #8B1E1E;">${order.itemName}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 10px 0; color: #6b7280;">Prénom</td>
              <td style="padding: 10px 0; color: #1f2937;">${order.name}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 10px 0; color: #6b7280;">Nom</td>
              <td style="padding: 10px 0; color: #1f2937;">${order.lastName}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 10px 0; color: #6b7280;">Localisation</td>
              <td style="padding: 10px 0; color: #1f2937;">${order.location}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 10px 0; color: #6b7280;">WhatsApp</td>
              <td style="padding: 10px 0;">
                <a href="https://wa.me/${order.whatsapp.replace(/\D/g, '')}" style="color: #25D366; font-weight: bold; text-decoration: none;">
                  ${order.whatsapp}
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; color: #6b7280;">Date</td>
              <td style="padding: 10px 0; color: #9ca3af; font-size: 13px;">${date}</td>
            </tr>
          </table>
        </div>
        <div style="background: #1A1A1A; padding: 16px 32px; text-align: center; font-size: 12px; color: #D4AF37;">
          CookAfrica — notification automatique &nbsp;•&nbsp; contact@cookafrica.com
        </div>
      </div>
    `,
  });
  if (result.error) {
    throw new Error(JSON.stringify(result.error));
  }
  console.log('[EMAIL] Envoyé avec succès à', notifyEmail, '— id:', result.data?.id);
};

const cors = require('cors');
const app = express();

const allowedOrigins = [
  'https://cookafrica.vercel.app',
  ...(process.env.FRONTEND_URL || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  'http://localhost:5173',
];

app.use(cors({
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origin (ex: Postman, server-to-server)
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(new Error(`CORS bloqué pour l'origine : ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/orders', async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Base de données non disponible.' });
  }

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

    sendOrderNotification(order).catch(err =>
      console.error('[EMAIL] Échec envoi Resend:', err.message)
    );

    res.status(201).json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('POST /api/orders error:', error);
    res.status(500).json({ error: 'Erreur serveur. Veuillez réessayer.' });
  }
});

app.get('/api/stats', async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Base de données non disponible.' });
  }

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
  console.log(`CookAfrica API — port ${PORT}`);
});
