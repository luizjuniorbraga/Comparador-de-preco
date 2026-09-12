const searchForm = document.querySelector('.search-form')
const input = document.querySelector('.product-input')
const list = document.querySelector('.product-list')
const canvas = document.querySelector('.price-chart')
const modeNote = document.querySelector('.mode-note')
const chips = document.querySelectorAll('.chip')

const ML_URL = (q) =>
    `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(q)}&limit=8`

const toPriceText = (n) =>
    n == null
        ? ''
        : 'R$ ' +
          Number(n).toLocaleString('pt-BR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
          })

function parseMlProducts(data) {
    return (data.results || [])
        .filter((r) => r.price != null && r.title)
        .map((r) => {
            const inst = r.installments
            return {
                name: r.title,
                price: Number(r.price),
                priceText: toPriceText(r.price),
                merchant: (r.seller && r.seller.nickname) || '',
                installments:
                    inst && inst.quantity > 1 && inst.amount != null
                        ? `${inst.quantity}x de ${toPriceText(inst.amount)}`
                        : '',
                image: (r.thumbnail || '').replace('http://', 'https://'),
                link: r.permalink || '',
            }
        })
}

chips.forEach(chip => {
    chip.addEventListener('click', () => {
        input.value = chip.dataset.query
        searchForm.dispatchEvent(new Event('submit'))
    })
})

searchForm.addEventListener('submit', async function (event) {
    event.preventDefault()

    const query = input.value.trim()
    if (!query) return

    list.innerHTML = '<p class="message">Buscando...</p>'
    canvas.style.display = 'none'
    modeNote.hidden = true

    try {
        const result = await searchProducts(query)

        if (result.via === 'mercadolivre') {
            modeNote.textContent =
                'Servidor indisponivel; exibindo resultados do Mercado Livre.'
            modeNote.hidden = false
        }

        render(result.products)
    } catch (err) {
        list.innerHTML = `<p class="message error">${err.message}</p>`
    }
})

async function tryServer(url) {
    try {
        const res = await fetch(url)
        const contentType = res.headers.get('content-type') || ''
        if (res.ok && contentType.includes('application/json')) {
            const data = await res.json()
            if (data.products && data.products.length) {
                return { products: data.products, via: 'server' }
            }
        }
    } catch {
        // nao alcancavel
    }
    return null
}

async function searchProducts(query) {
    const qs = encodeURIComponent(query)

    let result = await tryServer(`/api/search?q=${qs}`)
    if (!result && location.protocol === 'file:') {
        result = await tryServer(`http://localhost:3000/api/search?q=${qs}`)
    }
    if (result) return result

    let lastError = ''
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (attempt) await new Promise((r) => setTimeout(r, 1500))
            const res = await fetch(ML_URL(query))
            if (res.ok) {
                const products = parseMlProducts(await res.json())
                if (products.length) return { products, via: 'mercadolivre' }
            }
            lastError = 'HTTP ' + res.status
        } catch (err) {
            lastError = err.message || String(err)
        }
    }

    throw new Error(
        'Nao foi possivel buscar no Mercado Livre (' +
            lastError +
            '). Use o iniciar.bat para abrir pelo servidor, ou tente novamente em instantes.'
    )
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
                        ${isBest ? '<span class="tag">Menor preco</span>' : ''}
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
