const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 3000
const SOURCE = 'https://www.buscape.com.br/busca/'
const CACHE_TTL = 60000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

const cache = new Map()

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
]

function clean(s) {
  return (s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePrice(text) {
  const digits = (text || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')
  return parseFloat(digits)
}

function parseProducts(html) {
  const cards = [
    ...html.matchAll(/<article[^>]*data-testid="product-card"[^>]*>([\s\S]*?)<\/article>/g),
  ]
  const products = []

  for (const match of cards) {
    const block = match[1]
    const name = clean(
      (block.match(/product-card::name"\s*[^>]*>([\s\S]*?)<\/h2>/) || [])[1]
    )
    const priceText = clean(
      (block.match(/product-card::price"\s*[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/) || [])[1]
    )
    const rawLink = (block.match(/href="([^"]+)"/) || [])[1] || ''
    const merchant = clean(
      (block.match(/aria-label="Menor preço"\s*[^>]*>([\s\S]*?)<\/div>/) || [])[1] ||
        (block.match(/Via\s+[^<]+/) || [])[0]
    )
    const installments = clean(
      (block.match(/<span[^>]*>(\d+x\s+de\s+R\$\s+[\d.,]+)<\/span>/) || [])[1]
    )
    const image =
      (block.match(/data-testid="product-card::image"[\s\S]*?src="([^"]+)"/) || [])[1] || ''

    if (!name || !priceText) continue

    products.push({
      name,
      price: parsePrice(priceText),
      priceText,
      merchant,
      installments,
      image,
      link: rawLink.startsWith('http') ? rawLink : 'https://www.buscape.com.br' + rawLink,
    })
  }

  return products
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timer)
      if (res.status === 429 || res.status === 503) {
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
          continue
        }
      }
      return res
    } catch (err) {
      clearTimeout(timer)
      if (i === retries - 1) throw err
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
    }
  }
}

async function searchBuscape(query) {
  const url = SOURCE + encodeURIComponent(query)
  const ua = UA_LIST[Math.floor(Math.random() * UA_LIST.length)]
  const res = await fetchWithRetry(url, {
    headers: {
      'User-Agent': ua,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    },
  })
  if (res.status !== 200) throw new Error('Buscapé respondeu com status ' + res.status)
  return parseProducts(await res.text())
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim()
    if (!q) return sendJson(res, 400, { error: 'Informe o parâmetro q' })

    const now = Date.now()
    const cached = cache.get(q)
    if (cached && now - cached.time < CACHE_TTL) {
      return sendJson(res, 200, cached.data)
    }

    try {
      const data = { query: q, fetchedAt: new Date().toISOString(), products: await searchBuscape(q) }
      cache.set(q, { time: now, data })
      sendJson(res, 200, data)
    } catch (err) {
      console.error('Erro ao buscar no Buscapé:', err.message)
      sendJson(res, 502, { error: 'Falha ao consultar o Buscapé: ' + err.message })
    }
    return
  }

  if (url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok' })
  }

  const filePath = path.join(
    __dirname,
    url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)
  )
  const root = path.join(__dirname)
  if (!filePath.startsWith(root)) {
    return sendJson(res, 403, { error: 'Acesso negado' })
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('404 - Não encontrado')
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log('Comparador de Preços rodando em:')
  console.log('  http://localhost:' + PORT)
})