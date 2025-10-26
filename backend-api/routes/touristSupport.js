const express = require('express');
const router = express.Router();
const db = require('../db');

const MAX_MESSAGE_LENGTH = 600;
const SUPPORTED_LANGUAGES = {
  en: { label: 'English', aliases: ['en', 'english'] },
  hi: { label: 'हिन्दी', aliases: ['hi', 'hindi', 'hindustani', 'हिन्दी'] },
  bn: { label: 'বাংলা', aliases: ['bn', 'bengali', 'bangla', 'বাংলা'] },
  ta: { label: 'தமிழ்', aliases: ['ta', 'tamil', 'தமிழ்'] },
  te: { label: 'తెలుగు', aliases: ['te', 'telugu', 'తెలుగు'] },
  mr: { label: 'मराठी', aliases: ['mr', 'marathi', 'मराठी'] },
  kn: { label: 'ಕನ್ನಡ', aliases: ['kn', 'kannada', 'ಕನ್ನಡ'] }
};

const FALLBACK_RESPONSES = {
  en: 'Thanks for reaching out. For any urgent help call 1800-11-1363 or the emergency number 112. Share your live location with trusted contacts and stay in a well-lit public place while we gather more details.',
  hi: 'संपर्क करने के लिए धन्यवाद। किसी भी आपात स्थिति में 1800-11-1363 या 112 पर कॉल करें। जब तक हम अधिक जानकारी देते हैं तब तक अपनी लाइव लोकेशन भरोसेमंद संपर्कों के साथ साझा करें और रोशनी वाले सार्वजनिक स्थान पर रहें।',
  bn: 'যোগাযোগের জন্য ধন্যবাদ। জরুরি সহায়তার জন্য ১৮০০-১১-১৩৬৩ অথবা ১১২ নম্বরে ফোন করুন। আমরা আরও তথ্য দেওয়ার মধ্যে বিশ্বাসযোগ্য পরিচিতদের সঙ্গে আপনার লাইভ লোকেশন শেয়ার করুন এবং আলোকিত জনসমক্ষে থাকুন।',
  ta: 'தொடர்புக்கு நன்றி. அவசர உதவிக்காக 1800-11-1363 அல்லது 112 எண்ணை அழைக்கவும். மேலும் தகவலை வழங்கும் வரை உங்கள் நேரடி இருப்பிடத்தை நம்பகமானவர்களுடன் பகிர்ந்து, வெளிச்சமான பொதுப் பகுதியில் இருங்கள்.',
  te: 'సంప్రదించినందుకు ధన్యవాదాలు. అత్యవసర సహాయానికి 1800-11-1363 లేదా 112 కి కాల్ చేయండి. మేము మరిన్ని వివరాలు అందించే వరకు మీ ప్రత్యక్ష స్థానాన్ని నమ్మకమైన పరిచయాలతో పంచుకోండి మరియు వెలుతురు ఉన్న ప్రజా ప్రదేశంలో ఉండండి.',
  mr: 'संपर्क केल्याबद्दल धन्यवाद. आपतकालीन मदतीसाठी 1800-11-1363 किंवा 112 वर कॉल करा. आम्ही पुढील माहिती देईपर्यंत आपले थेट लोकेशन विश्वासू संपर्कांसोबत शेअर करा आणि प्रकाशमान सार्वजनिक ठिकाणी थांबा.',
  kn: 'ಸಂಪರ್ಕಿಸಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ತುರ್ತು ಸಹಾಯಕ್ಕಾಗಿ 1800-11-1363 ಅಥವಾ 112 ಗೆ ಕರೆ ಮಾಡಿ. ನಾವು ಹೆಚ್ಚಿನ ಮಾಹಿತಿ ನೀಡುವವರೆಗೆ ನಿಮ್ಮ ಲೈವ್ ಸ್ಥಳವನ್ನು ವಿಶ್ವಾಸಾರ್ಹ ಸಂಪರ್ಕಗಳೊಂದಿಗೆ ಹಂಚಿಕೊಳ್ಳಿ ಮತ್ತು ಬೆಳಕುಳ್ಳ ಸಾರ್ವಜನಿಕ ಸ್ಥಳದಲ್ಲಿ ನಿರಂತರವಾಗಿರಿ.'
};

const LANGUAGE_COLUMN_MAP = {
  en: 'response_en',
  hi: 'response_hi',
  bn: 'response_bn',
  ta: 'response_ta',
  te: 'response_te',
  mr: 'response_mr',
  kn: 'response_kn'
};

function normalizeLanguage(value) {
  if (!value) return 'en';
  const lowered = String(value).trim().toLowerCase();
  for (const [code, meta] of Object.entries(SUPPORTED_LANGUAGES)) {
    if (code === lowered) return code;
    if ((meta.aliases || []).includes(lowered)) return code;
  }
  return 'en';
}

function sanitizeRegion(value) {
  if (!value) return null;
  const cleaned = String(value).trim();
  if (!cleaned || cleaned.toLowerCase() === 'all') return null;
  return cleaned;
}

function sanitizeSearch(value) {
  if (!value) return null;
  const cleaned = String(value).trim();
  return cleaned.length ? cleaned : null;
}

function mapHelplineRow(row) {
  return {
    id: row.id,
    region: row.region,
    serviceName: row.service_name,
    phoneNumber: row.phone_number,
    availability: row.availability,
    languages: row.languages || [],
    description: row.description || '',
    priority: row.priority
  };
}

function pickResponse(faq, language) {
  if (!faq) return null;
  const column = LANGUAGE_COLUMN_MAP[language] || LANGUAGE_COLUMN_MAP.en;
  const response = faq[column];
  if (response && String(response).trim()) return response;
  return faq.response_en;
}

router.get('/helplines', async (req, res) => {
  try {
    const passportId = req.cookies?.passportId;
    if (!passportId) {
      return res.status(403).json({ message: 'Tourist session required.' });
    }

    // Accept multiple query aliases for convenience: q, query, search
    const rawQuery = req.query.q || req.query.query || req.query.search || null;
    const language = normalizeLanguage(req.query.language || req.query.lang);
    const region = sanitizeRegion(req.query.region || req.query.state || req.query.area);
    const search = sanitizeSearch(rawQuery);
    const limitCandidate = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitCandidate) && limitCandidate > 0
      ? Math.min(limitCandidate, 100)
      : 50;

    const helplines = await db.listTouristHelplines({
      language,
      region,
      search,
      limit
    });

    // Return wrapped object (language, total, helplines) — tests expect this shape.
    const mapped = (helplines || []).map(mapHelplineRow);
    return res.json({
      language,
      total: mapped.length,
      helplines: mapped
    });
  } catch (err) {
    console.error('GET /api/v1/tourist-support/helplines failed:', err?.message || err);
    return res.status(500).json({ message: 'Failed to load tourist helplines.' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const passportId = req.cookies?.passportId;
    if (!passportId) {
      return res.status(403).json({ message: 'Tourist session required.' });
    }

    const language = normalizeLanguage(req.body?.language);
    const rawMessage = (req.body?.message || '').trim();

    if (!rawMessage) {
      return res.status(400).json({ message: 'Message is required.' });
    }
    if (rawMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ message: 'Message is too long.' });
    }

    const faqs = await db.listTouristSupportFaqs();
    const normalizedMessage = rawMessage.toLowerCase();

    let bestFaq = null;
    let bestScore = 0;

    for (const faq of faqs) {
      const keywords = (faq.keywords || []).map((k) => String(k || '').toLowerCase());
      let score = 0;
      for (const keyword of keywords) {
        if (!keyword) continue;
        if (normalizedMessage.includes(keyword)) {
          score += keyword.length;
        } else {
          const parts = keyword.split(' ').filter(Boolean);
          const allPresent = parts.length && parts.every((part) => normalizedMessage.includes(part));
          if (allPresent) {
            score += parts.join('').length / 2;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestFaq = faq;
      }
    }

    let reply = pickResponse(bestFaq, language);
    const matchedKeywords = bestFaq?.keywords || [];
    const faqId = bestFaq?.id || null;
    const usedFallback = !reply;

    if (!reply) {
      reply = FALLBACK_RESPONSES[language] || FALLBACK_RESPONSES.en;
    }

    const suggestedHelplines = await db.listTouristHelplines({
      language,
      region: null,
      search: null,
      limit: 5
    });

    return res.json({
      reply,
      language,
      matchedKeywords,
      faqId,
      usedFallback,
      suggestedHelplines: suggestedHelplines.map(mapHelplineRow)
    });
  } catch (err) {
    console.error('POST /api/v1/tourist-support/chat failed:', err?.message || err);
    return res.status(500).json({ message: 'Unable to process chat request right now.' });
  }
});

module.exports = router;
