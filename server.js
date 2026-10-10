server.js الحالي (نسخة cde074e) مع إضافة rank في /api/me فقط:
const rankRow = db.prepare('SELECT COUNT(*) + 1 AS rank FROM users WHERE (wallet+bank) > (SELECT wallet+bank FROM users WHERE discord_id = ?)').get(u.discord_id);
وإضافة rank: rankRow.rank في الاستجابة.
باقي السيرفر بدون أي تغيير.