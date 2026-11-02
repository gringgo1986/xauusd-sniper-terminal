"""
XAU/USD Smart Sniper Signal Server & API Backend
FastAPI server serving institutional signals, live candlestick chart feeds,
and dynamic risk calculators.
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from data_provider import GoldDataProvider
from engine import SignalEngine

app = FastAPI(
    title="XAU/USD Smart Sniper Institutional Terminal",
    description="Algorithmic Smart Money Concepts (SMC) & Multi-Confluence Signal Engine for Gold",
    version="2.0.0"
)

# Initialize engines
provider = GoldDataProvider()
engine = SignalEngine()

class CalculatorRequest(BaseModel):
    account_balance: float = 1000.0
    risk_percentage: float = 1.0  # 1% standard institutional risk
    sl_pips: float = 60.0        # in pips (e.g. 60 pips = $6.00 move)

@app.get("/api/price")
def get_live_price():
    price_data = provider.get_live_price()
    curr_price = price_data.get("price", 0)
    if curr_price > 0:
        engine.update_active_signals(curr_price)
    return price_data

@app.get("/api/candles")
def get_candles(timeframe: str = "15m", count: int = 90):
    if timeframe not in ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]:
        timeframe = "15m"
    candles = provider.get_candles(timeframe, count)
    return {"timeframe": timeframe, "candles": candles}

@app.get("/api/signal")
def get_latest_signal(timeframe: str = "15m"):
    candles = provider.get_candles(timeframe, 90)
    signal = engine.analyze_signal(candles)
    curr_price = signal.get("current_price", 0)
    if curr_price > 0:
        engine.update_active_signals(curr_price)
    return signal

@app.get("/api/history")
def get_signal_history():
    price_data = provider.get_live_price()
    curr_price = price_data.get("price", 0)
    if curr_price > 0:
        engine.update_active_signals(curr_price)
    return {"history": engine.get_history()}

@app.get("/api/stats")
def get_stats():
    return engine.get_stats()

@app.post("/api/calculator")
def calculate_lot_size(req: CalculatorRequest):
    if req.sl_pips <= 0:
        raise HTTPException(status_code=400, detail="SL pips must be positive")
    
    # 1 standard lot = $10 per pip for XAU/USD ($1 move = 10 pips = $100 per 1.0 lot)
    # Risk Amount = Balance * (Risk% / 100)
    risk_amount = req.account_balance * (req.risk_percentage / 100.0)
    
    # Pip value per 1.0 standard lot = $10
    # Total loss if SL hit = Lots * sl_pips * $10 (or $1 per pip per 0.10 lot)
    # Lot = Risk Amount / (sl_pips * 10)
    recommended_lot = risk_amount / (req.sl_pips * 10.0)
    # Clamp to minimum broker lot (0.01)
    recommended_lot_clamped = max(round(recommended_lot, 2), 0.01)

    # Calculate monetary returns based on 1R (TP1), 2R (TP2), 3R (TP3), 4R (TP4), 5R (TP5)
    gain_tp1 = round(risk_amount * 1.0, 2)
    gain_tp2 = round(risk_amount * 2.0, 2)
    gain_tp3 = round(risk_amount * 3.0, 2)
    gain_tp4 = round(risk_amount * 4.0, 2)
    gain_tp5 = round(risk_amount * 5.0, 2)

    return {
        "account_balance": req.account_balance,
        "risk_percentage": req.risk_percentage,
        "risk_amount_usd": round(risk_amount, 2),
        "sl_pips": req.sl_pips,
        "recommended_lot": recommended_lot_clamped,
        "potential_gain_tp1_usd": gain_tp1,
        "potential_gain_tp2_usd": gain_tp2,
        "potential_gain_tp3_usd": gain_tp3,
        "potential_gain_tp4_usd": gain_tp4,
        "potential_gain_tp5_usd": gain_tp5,
        "risk_to_reward": "1:1 hingga 1:5 (Multi-Target)"
    }

@app.get("/api/market-analysis")
def get_detailed_analysis():
    candles = provider.get_candles("15m", 60)
    signal = engine.analyze_signal(candles)
    session = engine.get_market_session()

    return {
        "title": "Analisis Institusi & Teknikal XAU/USD (Emas)",
        "summary": "Analisis pasaran berasaskan Smart Money Concepts (SMC), Liquidity Hunt, dan Pengurusan Risiko Profesional.",
        "myth_buster": {
            "title": "Mitos Winrate 100% vs Realiti Pasaran Kewangan",
            "explanation": "Dalam dunia sebenar, TIADA trader, bank pusat, institusi mahupun algoritma AI di dunia yang mempunyai winrate 100%. Pasaran emas sentiasa tertakluk kepada ketidaktentuan makroekonomi (CPI, NFP, keputusan kadar faedah Fed, krisis geopolitik). Trader yang mencari '100% winrate' sering berakhir dengan 'Margin Call' kerana enggan meletakkan Stop Loss.",
            "the_real_edge": "Rahsia sebenar kekayaan konsisten adalah: High-Probability Setup (65%-80% Winrate) + Risk-to-Reward Ratio (RRR) minimum 1:2 atau 1:3 + Pengurusan Risiko 1-2% setiap trade. Dengan nisbah ini, walaupun hanya menang 6 daripada 10 trade, keuntungan bersih anda sangat lumayan!"
        },
        "top_techniques": [
            {
                "technique": "1. SMC Asian Session Liquidity Sweep (Judas Swing)",
                "details": "Di waktu sesi Asia (Tokyo/Sydney), harga emas lazimnya membina julat (Asian Range High & Low). Apabila London dibuka (15:00 waktu Malaysia / 07:00 UTC), institusi besar akan menolak harga menembusi Asian High/Low untuk memburu Stop Loss trader retail (Liquidity Sweep), sebelum membuat pusingan drastik ke arah sebenar."
            },
            {
                "technique": "2. Fair Value Gap (FVG) & Order Block (OB) Retest",
                "details": "Selepas berlakunya lonjakan harga yang agresif (Displacement) yang memecahkan struktur pasaran (CHoCH/BOS), pasaran meninggalkan zon ketidakseimbangan (FVG). Signal terbaik masuk pada fasa diskaun (Retest FVG) dengan Stop Loss yang sangat ketat (Sniper Entry)."
            },
            {
                "technique": "3. Multi-Timeframe Confluence (H4 -> M15 -> M5)",
                "details": "Gunakan H4 / Daily untuk menentukan arah aliran makro (di atas atau di bawah EMA 200). Gunakan M15 untuk memetakan struktur pasaran dan zon FVG/OB. Gunakan M5 untuk mencari 'trigger candle' kemasukan."
            },
            {
                "technique": "4. Pengurusan Risiko Dinamik ATR & Multi-Confluence 24 Jam",
                "details": "Signal kini beroperasi sepanjang 24 jam berdasarkan struktur teknikal tulen tanpa sekatan waktu sesi. Jarak Stop Loss diselaraskan secara dinamik dengan ATR pasaran untuk melindungi modal pada bila-bila masa setup Gred A terbentuk."
            }
        ],
        "active_setup": {
            "current_action": signal.get("action"),
            "grade": signal.get("grade"),
            "confidence": f"{signal.get('confidence_score')}%",
            "session": session.get("primary_session"),
            "killzone": session.get("active_killzone")
        }
    }

# Mount static folder (support both static/ subfolder and root directory on Vercel)
base_dir = os.path.dirname(__file__)
static_dir = os.path.join(base_dir, "static")
if not os.path.exists(os.path.join(static_dir, "index.html")) and os.path.exists(os.path.join(base_dir, "index.html")):
    static_dir = base_dir
elif not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)

if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def serve_index():
    for p in [os.path.join(static_dir, "index.html"), os.path.join(base_dir, "index.html")]:
        if os.path.exists(p):
            return FileResponse(p)
    return FileResponse(os.path.join(static_dir, "index.html"))

@app.get("/style.css")
def serve_root_css():
    for p in [os.path.join(base_dir, "style.css"), os.path.join(static_dir, "style.css")]:
        if os.path.exists(p):
            return FileResponse(p, media_type="text/css")
    raise HTTPException(status_code=404)

@app.get("/app.js")
def serve_root_js():
    for p in [os.path.join(base_dir, "app.js"), os.path.join(static_dir, "app.js")]:
        if os.path.exists(p):
            return FileResponse(p, media_type="application/javascript")
    raise HTTPException(status_code=404)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
