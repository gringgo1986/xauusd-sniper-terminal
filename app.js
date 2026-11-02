/**
 * XAU/USD Smart Sniper Trading Terminal
 * Frontend JavaScript Controller
 * - Auto-refreshing candlestick chart (every 15s)
 * - Live Swissquote price line on chart
 * - Price-corrected candles (aligned to Swissquote spot)
 */

let chart = null;
let candleSeries = null;
let ema50Series = null;
let ema200Series = null;
let priceLine = null;        // Live horizontal price line
let currentTf = "15m";
let lastSignalAction = null;
let currentSignalRaw = null;
let latestLivePrice = null;  // Cache for price line updates
let isFirstChartLoad = true;

// ──────────────────────────────────────────────
// Initialize
// ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initChart();
    setupEventListeners();
    setupTabs();

    // Initial fetches
    fetchPrice();
    fetchCandles(currentTf);
    fetchSignal();
    fetchHistory();
    fetchStats();
    updateHeaderClock();

    // Periodic polling
    setInterval(updateHeaderClock, 1000);   // Live clock (GMT+8 KL) every 1s
    setInterval(async () => {
        await fetchPrice();
        fetchHistory();                     // Segerak floating pips terus setiap kali harga tick Swissquote berubah
    }, 2000);                               // Live tick & floating monitor setiap 2s
    setInterval(() => fetchCandles(currentTf), 15000);  // Chart refresh every 15s
    setInterval(fetchSignal, 10000);        // Signal re-scan every 10s
    setInterval(fetchStats, 15000);         // Stats every 15s
    setInterval(updatePriceLine, 2500);     // Price line sync every 2.5s
});

// Update Header Live Clock (GMT+8 Kuala Lumpur - Format 12 Jam AM/PM)
function updateHeaderClock() {
    const elClock = document.getElementById("headerClock");
    if (!elClock) return;
    try {
        const now = new Date();
        const timeStr = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kuala_Lumpur',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        }).format(now);
        elClock.textContent = `${timeStr} MYT`;
    } catch (e) {
        // Fallback GMT+8 calculation
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const myt = new Date(utc + (3600000 * 8));
        let h = myt.getHours();
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        const pad = (n) => String(n).padStart(2, '0');
        elClock.textContent = `${pad(h)}:${pad(myt.getMinutes())}:${pad(myt.getSeconds())} ${ampm} MYT`;
    }
}

// ──────────────────────────────────────────────
// Chart Initialization (Configured for GMT+8 Kuala Lumpur - Format 12 Jam)
// ──────────────────────────────────────────────
function initChart() {
    const container = document.getElementById("chartContainer");
    if (!container) return;

    if (typeof LightweightCharts === "undefined") {
        container.innerHTML = `<div style="padding:20px;color:#f59e0b;text-align:center;">
            Chart library sedang dimuatkan... Sila refresh halaman.</div>`;
        return;
    }

    container.innerHTML = "";

    chart = LightweightCharts.createChart(container, {
        layout: {
            background: { color: '#0b0e14' },
            textColor: '#9ca3af',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
        },
        localization: {
            locale: 'en-US',
            dateFormat: 'dd/MM/yyyy',
            timeFormatter: (timestamp) => {
                const d = new Date(timestamp * 1000);
                return new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Kuala_Lumpur',
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                }).format(d) + ' MYT';
            }
        },
        grid: {
            vertLines: { color: 'rgba(36, 47, 69, 0.4)' },
            horzLines: { color: 'rgba(36, 47, 69, 0.4)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        },
        rightPriceScale: {
            borderColor: '#242f45',
            scaleMargins: { top: 0.08, bottom: 0.08 },
        },
        timeScale: {
            borderColor: '#242f45',
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 5,
            tickMarkFormatter: (time, tickMarkType, locale) => {
                const ts = typeof time === 'number' ? time : (time.timestamp || 0);
                const d = new Date(ts * 1000);
                // For day/month boundary ticks, show date
                if (tickMarkType < 3) {
                    return new Intl.DateTimeFormat('en-US', {
                        timeZone: 'Asia/Kuala_Lumpur',
                        day: '2-digit',
                        month: 'short'
                    }).format(d);
                }
                // For time ticks, show hour:minute AM/PM in GMT+8 (Kuala Lumpur)
                return new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Kuala_Lumpur',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                }).format(d);
            }
        },
    });

    // Candlestick series
    candleSeries = chart.addCandlestickSeries({
        upColor: '#10b981',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
    });

    // EMA 50 (Blue)
    ema50Series = chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        title: 'EMA 50',
        lastValueVisible: true,
        priceLineVisible: false,
    });

    // EMA 200 (Purple)
    ema200Series = chart.addLineSeries({
        color: '#a855f7',
        lineWidth: 2,
        title: 'EMA 200',
        lastValueVisible: true,
        priceLineVisible: false,
    });

    // Responsive resize
    const resizeChart = () => {
        if (chart && container) {
            chart.applyOptions({
                width: container.clientWidth,
                height: Math.max(container.clientHeight, 420)
            });
        }
    };
    window.addEventListener("resize", resizeChart);
    setTimeout(resizeChart, 150);
}

// ──────────────────────────────────────────────
// Fetch Candles & Render Chart
// ──────────────────────────────────────────────
async function fetchCandles(tf) {
    try {
        const res = await fetch(`/api/candles?timeframe=${tf}&count=120`);
        const data = await res.json();
        if (!data.candles || data.candles.length === 0 || !candleSeries) return;

        // De-duplicate and sort by time ascending
        const seen = new Set();
        const formatted = [];
        for (const c of data.candles) {
            if (!seen.has(c.time)) {
                seen.add(c.time);
                formatted.push({
                    time: c.time,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close
                });
            }
        }
        formatted.sort((a, b) => a.time - b.time);

        if (formatted.length === 0) return;

        candleSeries.setData(formatted);

        // Calculate EMAs
        const closes = formatted.map(c => c.close);
        const ema50 = calculateEma(closes, Math.min(50, closes.length));
        const ema200 = calculateEma(closes, Math.min(200, closes.length));

        ema50Series.setData(formatted.map((c, i) => ({ time: c.time, value: ema50[i] })));
        ema200Series.setData(formatted.map((c, i) => ({ time: c.time, value: ema200[i] })));

        // Only fitContent on first load, after that keep user's scroll position
        if (isFirstChartLoad) {
            chart.timeScale().fitContent();
            isFirstChartLoad = false;
        } else {
            // Scroll to show latest candle
            chart.timeScale().scrollToPosition(2, false);
        }

        // Update price line immediately
        updatePriceLine();

    } catch (e) {
        console.error("Error fetching candles:", e);
    }
}

// ──────────────────────────────────────────────
// Live Price Line on Chart
// ──────────────────────────────────────────────
function updatePriceLine() {
    if (!candleSeries || latestLivePrice === null) return;

    // Remove old price line
    if (priceLine) {
        try { candleSeries.removePriceLine(priceLine); } catch(e) {}
    }

    // Add new price line at current Swissquote price
    priceLine = candleSeries.createPriceLine({
        price: latestLivePrice,
        color: '#f59e0b',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'LIVE',
    });
}

// ──────────────────────────────────────────────
// Fetch Live Price (Swissquote Primary)
// ──────────────────────────────────────────────
async function fetchPrice() {
    try {
        const res = await fetch('/api/price');
        const data = await res.json();

        latestLivePrice = data.price;

        const elPrice = document.getElementById("headerPrice");
        const elBidAsk = document.getElementById("headerBidAsk");
        const elSpread = document.getElementById("headerSpread");
        const elChange = document.getElementById("headerChange");
        const elRange = document.getElementById("headerRange");
        const elFeed = document.getElementById("dataFeedSource");

        if (elPrice) {
            elPrice.textContent = `$${data.price.toFixed(2)}`;
            // Flash effect
            elPrice.style.transition = 'color 0.2s';
            elPrice.style.color = '#f59e0b';
            setTimeout(() => { elPrice.style.color = '#f3f4f6'; }, 400);
        }

        // Show Bid/Ask if available (Swissquote)
        if (elBidAsk) {
            if (data.bid && data.ask) {
                elBidAsk.textContent = `${data.bid.toFixed(3)} / ${data.ask.toFixed(3)}`;
            } else {
                elBidAsk.textContent = `${(data.price - 0.25).toFixed(2)} / ${(data.price + 0.25).toFixed(2)}`;
            }
        }

        // Show Spread
        if (elSpread) {
            if (data.spread !== undefined && data.spread !== null) {
                elSpread.textContent = `${data.spread.toFixed(1)} pts`;
            } else {
                elSpread.textContent = "~0.5 pts";
            }
        }

        if (elChange) {
            const chg = data.change_24h_percent || 0;
            elChange.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
            elChange.style.color = chg >= 0 ? '#10b981' : '#ef4444';
        }
        if (elRange) {
            const h = data.high_24h || data.price;
            const l = data.low_24h || data.price;
            elRange.textContent = `$${h.toFixed(1)} / $${l.toFixed(1)}`;
        }
        if (elFeed && data.source) {
            elFeed.textContent = `${data.source.toUpperCase()} ✓`;
        }
    } catch (e) {
        console.error("Error fetching price:", e);
    }
}

// ──────────────────────────────────────────────
// Fetch Signal
// ──────────────────────────────────────────────
async function fetchSignal() {
    try {
        const res = await fetch(`/api/signal?timeframe=${currentTf}`);
        const sig = await res.json();
        currentSignalRaw = sig;

        // Session badge
        const sessionBadge = document.getElementById("sessionBadge");
        if (sessionBadge && sig.session) {
            sessionBadge.textContent = `${sig.session.primary_session} (${sig.session.current_utc})`;
        }

        // Metrics ribbon
        const mAction = document.getElementById("metricAction");
        const mGrade = document.getElementById("metricGrade");
        const mConf = document.getElementById("metricConfidence");
        const mRR = document.getElementById("metricRR");

        if (mAction) {
            mAction.textContent = sig.action;
            mAction.className = "metric-value highlight-signal " +
                (sig.action.includes("BUY") ? "text-emerald" :
                 (sig.action.includes("SELL") ? "text-rose" : "text-gold"));
        }
        if (mGrade) mGrade.textContent = `${sig.grade} Confluence`;
        if (mConf) mConf.textContent = `${sig.confidence_score}%`;
        if (mRR) mRR.textContent = sig.risk_reward_ratio || "1:2.8";

        // Signal badge
        const sigBadge = document.getElementById("signalBadge");
        const sigQuality = document.getElementById("signalQualityPill");
        if (sigBadge) {
            sigBadge.textContent = sig.action;
            sigBadge.className = "signal-type-badge " +
                (sig.action.includes("BUY") ? "buy" :
                 (sig.action.includes("SELL") ? "sell" : ""));
        }
        if (sigQuality) sigQuality.textContent = `${sig.grade} (${sig.confidence_score}%)`;

        // Price targets
        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl("entryZoneText", `Zon Isyarat: ${sig.entry_zone || 'Pasaran Terbuka'}`);
        setEl("entryPrice", `$${sig.entry_price ? sig.entry_price.toFixed(2) : '----.--'}`);
        setEl("slPrice", `$${sig.stop_loss ? sig.stop_loss.toFixed(2) : '----.--'}`);
        setEl("slPipsText", `Jarak SL: ${sig.sl_pips || 0} Pips (Risiko Ketat)`);
        setEl("tp1Price", `$${sig.take_profit_1 ? sig.take_profit_1.toFixed(2) : '----.--'} (+${sig.tp1_pips || 0} p)`);
        setEl("tp2Price", `$${sig.take_profit_2 ? sig.take_profit_2.toFixed(2) : '----.--'} (+${sig.tp2_pips || 0} p)`);
        setEl("tp3Price", `$${sig.take_profit_3 ? sig.take_profit_3.toFixed(2) : '----.--'} (+${sig.tp3_pips || 0} p)`);
        setEl("tp4Price", `$${sig.take_profit_4 ? sig.take_profit_4.toFixed(2) : '----.--'} (+${sig.tp4_pips || 0} p)`);
        setEl("tp5Price", `$${sig.take_profit_5 ? sig.take_profit_5.toFixed(2) : '----.--'} (+${sig.tp5_pips || 0} p)`);

        // Indicator pills
        setEl("valRsi", sig.rsi14 || "--");
        setEl("valAtr", sig.atr14 || "--");
        setEl("valEma50", sig.ema50 || "--");
        setEl("valEma200", sig.ema200 || "--");

        // Checklist
        const checklistCont = document.getElementById("checklistContainer");
        if (checklistCont && sig.checklist) {
            checklistCont.innerHTML = sig.checklist.map(item => `
                <div class="check-item ${item.passed ? 'passed' : 'failed'}">
                    <span class="check-icon">${item.passed ? '✓' : '✗'}</span>
                    <div class="check-text">
                        <strong>${item.item}</strong>: ${item.desc}
                    </div>
                </div>
            `).join("");
        }

        // Audio alert on signal change
        if (lastSignalAction && lastSignalAction !== sig.action &&
            (sig.action.includes("BUY") || sig.action.includes("SELL"))) {
            playAudioAlert();
        }
        lastSignalAction = sig.action;

    } catch (e) {
        console.error("Error fetching signal:", e);
    }
}

// ──────────────────────────────────────────────
// History & Stats
// ──────────────────────────────────────────────
async function fetchHistory() {
    try {
        const res = await fetch('/api/history');
        const data = await res.json();
        const tbody = document.getElementById("historyTableBody");
        if (!tbody || !data.history) return;

        tbody.innerHTML = data.history.map(h => {
            let badgeClass = "badge-active";
            if (h.status === "WIN") badgeClass = "badge-win";
            if (h.status === "LOSS") badgeClass = "badge-loss";

            // Format Tarikh & Masa sahaja (tanpa kod ID)
            let datePart = h.date_str || "";
            let timePart = h.time_only || "";
            if (!datePart && h.time_str) {
                if (h.time_str.includes("•")) {
                    const parts = h.time_str.split("•");
                    datePart = parts[0].trim();
                    timePart = parts[1].trim();
                } else if (h.time_str.includes("Hari Ini") || h.time_str.includes("Semalam")) {
                    datePart = h.time_str.split(" ")[0] + " " + (h.time_str.split(" ")[1] || "");
                    timePart = h.time_str.replace(datePart, "").trim();
                } else {
                    datePart = h.time_str;
                }
            }

            // Ambil harga terakhir Take Profit atau BE sahaja
            let tpDisplay = "--";
            const resUpper = (h.result || "").toUpperCase();
            const statUpper = (h.status || "").toUpperCase();

            if (h.last_tp_or_be) {
                tpDisplay = h.last_tp_or_be;
            } else if (resUpper.includes("BE") || resUpper.includes("BREAKEVEN") || statUpper === "BE") {
                tpDisplay = `BE ($${h.entry.toFixed(2)})`;
            } else if (resUpper.includes("TP5") && h.tp5) {
                tpDisplay = `$${h.tp5.toFixed(2)}`;
            } else if (resUpper.includes("TP4") && h.tp4) {
                tpDisplay = `$${h.tp4.toFixed(2)}`;
            } else if (resUpper.includes("TP3") && h.tp3) {
                tpDisplay = `$${h.tp3.toFixed(2)}`;
            } else if (resUpper.includes("TP2") && h.tp2) {
                tpDisplay = `$${h.tp2.toFixed(2)}`;
            } else if (resUpper.includes("TP1") && h.tp1) {
                tpDisplay = `$${h.tp1.toFixed(2)}`;
            } else if (statUpper === "ACTIVE") {
                if (h.highest_tp_hit >= 1) {
                    const hitKey = `tp${h.highest_tp_hit}`;
                    tpDisplay = `$${(h[hitKey] || h.tp1).toFixed(2)}`;
                } else {
                    const finalTp = h.tp5 || h.tp3 || h.tp2 || h.tp1;
                    tpDisplay = finalTp ? `$${finalTp.toFixed(2)}` : "--";
                }
            } else if (statUpper === "LOSS" || resUpper.includes("SL")) {
                tpDisplay = "--";
            } else {
                const finalTp = h.tp5 || h.tp2 || h.tp1;
                tpDisplay = finalTp ? `$${finalTp.toFixed(2)}` : "--";
            }

            const tpColor = tpDisplay.startsWith("BE") ? "color: #38bdf8;" : (tpDisplay === "--" ? "color: #9ca3af;" : "color: #10b981;");

            return `
                <tr>
                    <td>
                        <div style="font-weight: 700; color: #f3f4f6; font-size: 13px;">${datePart}</div>
                        <div style="color: #f59e0b; font-size: 11px; margin-top: 2px; font-weight: 600;">${timePart}</div>
                    </td>
                    <td><span class="${h.action === 'BUY' ? 'text-emerald' : 'text-rose'}"><strong>${h.action}</strong></span></td>
                    <td><small>${h.grade}</small></td>
                    <td>$${h.entry.toFixed(2)}</td>
                    <td class="text-rose">$${h.sl.toFixed(2)}</td>
                    <td><span style="font-weight: 700; font-size: 13px; ${tpColor}">${tpDisplay}</span></td>
                    <td><span class="${badgeClass}">${h.result}</span></td>
                    <td class="${h.pnl_pips >= 0 ? 'text-emerald' : 'text-rose'}"><strong>${h.pnl_pips >= 0 ? '+' : ''}${h.pnl_pips} pips</strong></td>
                </tr>
            `;
        }).join("");
    } catch (e) {
        console.error("Error fetching history:", e);
    }
}

async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();
        const elWinRate = document.getElementById("metricWinRate");
        const elPips = document.getElementById("metricProfitPips");
        if (elWinRate) elWinRate.textContent = `${stats.win_rate_percent}%`;
        if (elPips) elPips.textContent = `+${stats.total_profit_pips} Pips`;
    } catch (e) {
        console.error("Error fetching stats:", e);
    }
}

// ──────────────────────────────────────────────
// Event Listeners
// ──────────────────────────────────────────────
function setupEventListeners() {
    document.querySelectorAll(".tf-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentTf = btn.getAttribute("data-tf");
            isFirstChartLoad = true;
            fetchCandles(currentTf);
            fetchSignal();
        });
    });

    document.getElementById("btnRefreshChart")?.addEventListener("click", () => {
        isFirstChartLoad = true;
        fetchCandles(currentTf);
    });
    document.getElementById("btnRefreshSignal")?.addEventListener("click", () => {
        fetchSignal();
        isFirstChartLoad = true;
        fetchCandles(currentTf);
    });

    document.getElementById("btnCopySignal")?.addEventListener("click", copySignalToClipboard);
    document.getElementById("btnCalculate")?.addEventListener("click", runLotCalculation);
    document.getElementById("calcBalance")?.addEventListener("input", runLotCalculation);
    document.getElementById("calcRiskPct")?.addEventListener("change", runLotCalculation);
    document.getElementById("calcSlPips")?.addEventListener("input", runLotCalculation);
}

function setupTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(btn.getAttribute("data-tab"))?.classList.add("active");
        });
    });
}

// ──────────────────────────────────────────────
// Calculator
// ──────────────────────────────────────────────
async function runLotCalculation() {
    const balance = parseFloat(document.getElementById("calcBalance").value) || 1000;
    const riskPct = parseFloat(document.getElementById("calcRiskPct").value) || 1.0;
    const slPips = parseFloat(document.getElementById("calcSlPips").value) || 60;
    try {
        const res = await fetch('/api/calculator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_balance: balance, risk_percentage: riskPct, sl_pips: slPips })
        });
        const data = await res.json();
        document.getElementById("resLot").textContent = `${data.recommended_lot} Lot`;
        document.getElementById("resMaxLoss").textContent = `-$${data.risk_amount_usd.toFixed(2)}`;
        document.getElementById("resGainTp1").textContent = `+$${data.potential_gain_tp1_usd.toFixed(2)}`;
        document.getElementById("resGainTp2").textContent = `+$${data.potential_gain_tp2_usd.toFixed(2)}`;
        document.getElementById("resGainTp3").textContent = `+$${data.potential_gain_tp3_usd.toFixed(2)}`;
        if (document.getElementById("resGainTp4") && data.potential_gain_tp4_usd !== undefined) {
            document.getElementById("resGainTp4").textContent = `+$${data.potential_gain_tp4_usd.toFixed(2)}`;
        }
        if (document.getElementById("resGainTp5") && data.potential_gain_tp5_usd !== undefined) {
            document.getElementById("resGainTp5").textContent = `+$${data.potential_gain_tp5_usd.toFixed(2)}`;
        }
    } catch (e) {
        console.error("Calculator error:", e);
    }
}

// ──────────────────────────────────────────────
// Clipboard & Audio
// ──────────────────────────────────────────────
function copySignalToClipboard() {
    if (!currentSignalRaw || !currentSignalRaw.telegram_format) {
        alert("Signal sedang diproses, sila tunggu sebentar...");
        return;
    }
    navigator.clipboard.writeText(currentSignalRaw.telegram_format).then(() => {
        const fb = document.getElementById("copyFeedback");
        if (fb) { fb.style.display = "block"; setTimeout(() => { fb.style.display = "none"; }, 3000); }
    }).catch(err => console.error("Clipboard copy failed:", err));
}

function playAudioAlert() {
    const toggle = document.getElementById("audioToggle");
    if (toggle && toggle.checked) {
        const audio = document.getElementById("alertAudio");
        if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
    }
}

// ──────────────────────────────────────────────
// EMA calculation helper
// ──────────────────────────────────────────────
function calculateEma(prices, period) {
    if (!prices || prices.length === 0) return [];
    if (prices.length <= period) {
        // Not enough data — just return SMA of available data
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        return prices.map(() => avg);
    }
    const k = 2 / (period + 1);
    let ema = [prices.slice(0, period).reduce((a, b) => a + b, 0) / period];
    for (let i = period; i < prices.length; i++) {
        ema.push(prices[i] * k + ema[ema.length - 1] * (1 - k));
    }
    const pad = new Array(period - 1).fill(ema[0]);
    return pad.concat(ema);
}
