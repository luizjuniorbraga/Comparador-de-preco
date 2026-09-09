const searchForm = document.querySelector('.search-form')
const input = document.querySelector('.product-input')
const list = document.querySelector('.product-list')
const canvas = document.querySelector('.price-chart')
const modeNote = document.querySelector('.mode-note')

const BUSCAPE_URL = (q) => `https://www.buscape.com.br/busca/${encodeURIComponent(q)}`

const PROXIES = [
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsfix.com/proxy?url=${encodeURIComponent(url)}`,
]

searchForm.addEventListener('submit', async function (event) {
    event.preventDefault()

    const query = input.value.trim()
    if (!query) return

    list.innerHTML = '<p class="message">Buscando...</p>'
    canvas.style.display = 'none'
    modeNote.hidden = true

    try {
        const result = await searchProducts(query)

        if (result.via === 'proxy') {
            modeNote.hidden = true
        }

        render(result.products)
    } catch (err) {
        list.innerHTML = `<p class="message error">${err.message}</p>`
    }
})

async function searchProducts(query) {
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        const contentType = res.headers.get('content-type') || ''
        if (res.ok && contentType.includes('application/json')) {
            const data = await res.json()
            return { products: data.products, via: 'server' }
        }
    } catch {
        // servidor indisponível (ex.: index.html aberto direto) -> tenta proxy
    }

    const buscapeUrl = BUSCAPE_URL(query)
    for (const makeProxy of PROXIES) {
        try {
            const res = await fetch(makeProxy(buscapeUrl))
            if (!res.ok) continue
            const products = parseProducts(await res.text())
            if (products.length) return { products, via: 'proxy' }
        } catch {
            // tenta o próximo proxy
        }
    }

    throw new Error(
        'Não foi possível buscar no Buscapé. Tente novamente em alguns segundos.'
    )
}

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

function render(products) {
    if (!products.length) {
        list.innerHTML = '<p class="message error">Nenhum produto encontrado.</p>'
        return
    }

    const sorted = products.slice().sort((a, b) => a.price - b.price)
    const best = sorted[0]

    list.innerHTML = sorted
        .map((p) => {
            const isBest = p === best
            const img = p.image
                ? `<img class="product-image" src="${p.image}" alt="${p.name}" loading="lazy">`
                : `<div class="product-image product-image--empty"></div>`
            return `
                <a class="product-card${isBest ? ' best' : ''}" href="${p.link}" target="_blank" rel="noopener">
                    <div class="product-media">
                        ${img}
                        ${isBest ? '<span class="tag">Menor preço</span>' : ''}
                    </div>
                    <div class="product-info">
                        <div class="product-name">${p.name}</div>
                        <div class="product-meta">${p.merchant}${p.installments ? ' · ' + p.installments : ''}</div>
                    </div>
                    <div class="product-price">${p.priceText}</div>
                </a>
            `
        })
        .join('')

    drawChart(sorted.slice(0, 8))
}

function drawChart(products) {
    const dpr = window.devicePixelRatio || 1
    const width = canvas.parentElement.clientWidth
    const height = 300

    if (!width) return

    canvas.style.display = 'block'
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'

    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    const margin = { top: 20, right: 10, bottom: 45, left: 10 }
    const chartWidth = width - margin.left - margin.right
    const chartHeight = height - margin.top - margin.bottom

    const maxBars = Math.max(3, Math.min(8, Math.floor((chartWidth - 10) / 52)))
    const data = products.slice(0, maxBars)

    const gap = Math.max(4, Math.min(16, chartWidth / (data.length * 8)))
    const barW = Math.max(6, chartWidth / data.length - gap)
    const max = Math.max(...data.map((p) => p.price))

    ctx.font = '10px Arial'

    data.forEach((p, i) => {
        const barH = Math.max(2, (p.price / max) * chartHeight)
        const x = margin.left + i * (barW + gap)
        const y = margin.top + chartHeight - barH

        ctx.fillStyle = i === 0 ? '#2e7d32' : '#1976d2'
        ctx.fillRect(x, y, barW, barH)

        ctx.textAlign = 'center'
        ctx.fillStyle = '#333'
        const priceLabel = p.price.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })
        ctx.fillText(priceLabel, x + barW / 2, y - 4)

        const maxChars = Math.max(3, Math.floor(barW / 6))
        const name =
            p.name.length > maxChars ? p.name.slice(0, maxChars - 1) + '…' : p.name
        ctx.fillText(name, x + barW / 2, height - 12)
    })

    ctx.fillStyle = '#e3e8ec'
    ctx.fillRect(margin.left, margin.top + chartHeight, width - margin.left - margin.right, 1)
}