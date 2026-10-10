server.js الحالي مع تعديل /api/me فقط: إضافة sentCount وreceivedCount وtotalTransactions:
const sent = db.prepare('SELECT COUNT(*) c FROM transactions WHERE sender=?').get(u.discord_id).c;
const received = db.prepare('SELECT COUNT(*) c FROM transactions WHERE receiver=?').get(u.discord_id).c;
وإضافتهم في الاستجابة: sentCount:sent, receivedCount:received, totalTransactions:sent+received.
باقي السيرفر بدون أي تغيير.