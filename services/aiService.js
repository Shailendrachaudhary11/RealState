const https = require('https');
const dns = require('dns');

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

/**
 * Single Configured Gemini Model from .env
 */
const getGeminiModel = () => {
  return process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
};

/**
 * Direct HTTPS Gemini REST Caller with Strict IPv4 (Prevents Linux undici fetch drops)
 */
const callGeminiHttpsRest = ({
  modelName,
  prompt,
  systemInstruction = null,
  maxTokens = 850,
  temperature = 0.2,
  responseMimeType = 'application/json',
  timeoutMs = 10000,
}) => {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return reject(new Error('GEMINI_API_KEY is not defined or configured in .env'));
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const contents = [{ parts: [{ text: prompt }] }];
    const bodyObj = {
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    };

    if (responseMimeType) {
      bodyObj.generationConfig.responseMimeType = responseMimeType;
    }

    if (systemInstruction) {
      bodyObj.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const payload = JSON.stringify(bodyObj);
    const parsedUrl = new URL(url);

    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      family: 4, // Enforce IPv4 strictly (fixes Linux server IPv6 connection drop)
      rejectUnauthorized: false,
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP_${res.statusCode}: ${body.slice(0, 300)}`));
        }

        try {
          const json = JSON.parse(body);
          const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!rawText) {
            return reject(new Error(`No text candidates returned: ${body.slice(0, 200)}`));
          }
          resolve(rawText);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Gemini HTTPS timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
};

/**
 * Secondary Fallback Engine: OpenAI GPT-4o-mini
 */
const callOpenAiFallback = async ({
  prompt,
  systemInstruction = null,
  isJson = true,
  maxTokens = 850,
  temperature = 0.2,
}) => {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey || openAiKey === 'your_openai_api_key_here') {
    throw new Error('OPENAI_API_KEY is not defined or configured in .env');
  }

  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: openAiKey });

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  const params = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (isJson) {
    params.response_format = { type: 'json_object' };
  }

  const completion = await openai.chat.completions.create(params);
  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No content returned from OpenAI');
  }
  return content;
};

/**
 * Centralized Structured JSON AI Generator with Dual-Engine Fallback
 * (Single Gemini Model -> OpenAI Fallback -> Graceful Error)
 */
const generateStructuredJson = async ({
  prompt,
  systemInstruction = null,
  maxTokens = 850,
  temperature = 0.15,
  timeoutMs = 9000,
}) => {
  const diagnosticErrors = [];
  const modelName = getGeminiModel();

  // 1. Primary Engine: Google Gemini REST via IPv4 (Single Model)
  try {
    const rawText = await callGeminiHttpsRest({
      modelName,
      prompt,
      systemInstruction,
      maxTokens,
      temperature,
      responseMimeType: 'application/json',
      timeoutMs,
    });

    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);
    if (parsed && typeof parsed === 'object') {
      return { data: parsed, engine: `Gemini [${modelName}]`, error: null };
    }
  } catch (err) {
    diagnosticErrors.push(`Gemini [${modelName}]: ${err.message}`);
    console.warn(`[AI Engine] Gemini [${modelName}] failed (${err.message}). Trying secondary engine...`);
  }

  // 2. Secondary Engine: OpenAI GPT-4o-mini
  try {
    const rawContent = await callOpenAiFallback({
      prompt,
      systemInstruction,
      isJson: true,
      maxTokens,
      temperature,
    });
    const parsed = JSON.parse(rawContent);
    if (parsed && typeof parsed === 'object') {
      return { data: parsed, engine: 'OpenAI [gpt-4o-mini]', error: null };
    }
  } catch (openAiErr) {
    diagnosticErrors.push(`OpenAI: ${openAiErr.message}`);
    console.warn(`[AI Engine] Secondary OpenAI failed (${openAiErr.message}).`);
  }

  return {
    data: null,
    engine: null,
    error: diagnosticErrors.join(' | '),
  };
};

/**
 * Centralized Natural Text AI Generator (For pitches, marketing copy, etc.)
 */
const generateText = async ({
  prompt,
  systemInstruction = null,
  maxTokens = 500,
  temperature = 0.2,
  timeoutMs = 8000,
}) => {
  const diagnosticErrors = [];
  const modelName = getGeminiModel();

  // 1. Primary Engine: Google Gemini (Single Model)
  try {
    const rawText = await callGeminiHttpsRest({
      modelName,
      prompt,
      systemInstruction,
      maxTokens,
      temperature,
      responseMimeType: null,
      timeoutMs,
    });

    if (rawText && typeof rawText === 'string') {
      return { text: rawText.trim(), engine: `Gemini [${modelName}]`, error: null };
    }
  } catch (err) {
    diagnosticErrors.push(`Gemini [${modelName}]: ${err.message}`);
    console.warn(`[AI Engine] Gemini [${modelName}] failed (${err.message}). Trying secondary engine...`);
  }

  // 2. Secondary Engine: OpenAI
  try {
    const rawContent = await callOpenAiFallback({
      prompt,
      systemInstruction,
      isJson: false,
      maxTokens,
      temperature,
    });
    if (rawContent) {
      return { text: rawContent.trim(), engine: 'OpenAI [gpt-4o-mini]', error: null };
    }
  } catch (openAiErr) {
    diagnosticErrors.push(`OpenAI: ${openAiErr.message}`);
  }

  return {
    text: null,
    engine: null,
    error: diagnosticErrors.join(' | '),
  };
};

module.exports = {
  generateStructuredJson,
  generateText,
  getGeminiModel,
  callGeminiHttpsRest,
  callOpenAiFallback,
};

