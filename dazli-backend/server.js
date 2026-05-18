const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Firebase Admin SDK Initialization
// يجب أن تضع ملف serviceAccountKey.json في نفس المجلد
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});

const db = admin.firestore();
const auth = admin.auth();

// ==================== AUTH ROUTES ====================

// تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password, role } = req.body;

    if (!phone || !password || !role) {
      return res.status(400).json({ error: 'Phone, password, and role are required' });
    }

    // البحث عن المستخدم في Firestore
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('phone', '==', phone).where('role', '==', role).get();

    if (snapshot.empty) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }

    const user = snapshot.docs[0].data();
    const userId = snapshot.docs[0].id;

    // التحقق من كلمة المرور (في الإنتاج استخدم bcrypt)
    if (user.password !== password) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }

    // إنشاء Custom Token من Firebase
    const customToken = await auth.createCustomToken(userId);

    res.json({
      token: customToken,
      user: {
        id: userId,
        name: user.name,
        phone: user.phone,
        role: user.role,
        email: user.email || null
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// التسجيل (إنشاء حساب جديد)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, password, name, role, email } = req.body;

    if (!phone || !password || !name || !role) {
      return res.status(400).json({ error: 'Phone, password, name, and role are required' });
    }

    // التحقق من عدم وجود رقم هاتف مسجل مسبقاً
    const existingUser = await db.collection('users')
      .where('phone', '==', phone)
      .where('role', '==', role)
      .get();

    if (!existingUser.empty) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }

    // إنشاء مستخدم جديد
    const newUser = {
      phone,
      password, // في الإنتاج يجب تشفير كلمة المرور
      name,
      role,
      email: email || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'active',
      rating: 0,
      totalOrders: 0
    };

    const docRef = await db.collection('users').add(newUser);
    const customToken = await auth.createCustomToken(docRef.id);

    res.status(201).json({
      token: customToken,
      user: {
        id: docRef.id,
        name: newUser.name,
        phone: newUser.phone,
        role: newUser.role,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// الحصول على بيانات المستخدم الحالي
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // التحقق من صحة التوكن
    const decodedToken = await auth.verifyIdToken(token);
    const userId = decodedToken.uid;

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    res.json({
      id: userId,
      name: userData.name,
      phone: userData.phone,
      role: userData.role,
      email: userData.email,
      rating: userData.rating,
      totalOrders: userData.totalOrders
    });
  } catch (error) {
    console.error('Auth/me error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ==================== ORDERS ROUTES ====================

// إنشاء طلب جديد
app.post('/api/orders', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    const userId = decodedToken.uid;

    const {
      service_type,
      customer_phone,
      address_text,
      order_price,
      delivery_price,
      total_price,
      payment_method,
      notes,
      districtId,
      latitude,
      longitude
    } = req.body;

    const newOrder = {
      customerId: userId,
      customerPhone: customer_phone,
      serviceType: service_type,
      addressText: address_text,
      orderPrice: order_price,
      deliveryPrice: delivery_price,
      totalPrice: total_price,
      paymentMethod: payment_method,
      notes: notes || '',
      districtId: districtId,
      latitude: latitude || null,
      longitude: longitude || null,
      status: 'pending', // pending -> accepted -> on_the_way -> delivered
      courierId: null,
      courierName: null,
      courierPhone: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      rating: null
    };

    const docRef = await db.collection('orders').add(newOrder);

    res.status(201).json({
      id: docRef.id,
      ...newOrder,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// الحصول على تفاصيل الطلب
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderDoc = await db.collection('orders').doc(orderId).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({
      id: orderId,
      ...orderDoc.data()
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// تحديث حالة الطلب
app.patch('/api/orders/:orderId/status', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    const { orderId } = req.params;
    const { status, courierId, courierName, courierPhone } = req.body;

    const updateData = {
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (courierId) {
      updateData.courierId = courierId;
      updateData.courierName = courierName;
      updateData.courierPhone = courierPhone;
    }

    await db.collection('orders').doc(orderId).update(updateData);

    const updatedOrder = await db.collection('orders').doc(orderId).get();
    res.json({
      id: orderId,
      ...updatedOrder.data()
    });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// تقييم الطلب
app.post('/api/orders/:orderId/rate', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    const { orderId } = req.params;
    const { rating } = req.body;

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    await db.collection('orders').doc(orderId).update({
      rating,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      pointsAwarded: Math.floor(rating * 10)
    });
  } catch (error) {
    console.error('Rate order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== COURIER ROUTES ====================

// الحصول على قائمة الطلبات المتاحة
app.get('/api/courier/orders', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);

    // الحصول على الطلبات المعلقة والمقبولة من هذا المندوب
    const snapshot = await db.collection('orders')
      .where('status', 'in', ['pending', 'accepted', 'on_the_way'])
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const orders = [];
    snapshot.forEach(doc => {
      orders.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json(orders);
  } catch (error) {
    console.error('Get courier orders error:', error);
    res.status(500).json({ error: error.message });
  }
});

// قبول الطلب من المندوب
app.patch('/api/courier/orders/:orderId/accept', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    const courierId = decodedToken.uid;
    const { orderId } = req.params;

    // الحصول على بيانات المندوب
    const courierDoc = await db.collection('users').doc(courierId).get();
    const courierData = courierDoc.data();

    // تحديث الطلب بقبول المندوب
    await db.collection('orders').doc(orderId).update({
      status: 'accepted',
      courierId: courierId,
      courierName: courierData.name,
      courierPhone: courierData.phone,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const updatedOrder = await db.collection('orders').doc(orderId).get();
    res.json({
      id: orderId,
      ...updatedOrder.data()
    });
  } catch (error) {
    console.error('Accept order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// الحصول على أرباح المندوب
app.get('/api/courier/earnings', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    const courierId = decodedToken.uid;

    const snapshot = await db.collection('orders')
      .where('courierId', '==', courierId)
      .where('status', '==', 'delivered')
      .get();

    let totalEarnings = 0;
    snapshot.forEach(doc => {
      totalEarnings += doc.data().deliveryPrice || 0;
    });

    res.json({
      totalEarnings,
      completedOrders: snapshot.size
    });
  } catch (error) {
    console.error('Get earnings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ERROR HANDLING ====================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Dazli Backend Server running on port ${PORT}`);
  console.log(`📍 API Base URL: http://localhost:${PORT}/api`);
});
