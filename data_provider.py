"""
XAU/USD Real-time & Historical Data Provider
Primary price feed: Swissquote Public BBO Quotes (forex-data-feed.swissquote.com)
Candle data: Yahoo Finance GC=F with automatic offset correction to match Swissquote spot,
plus synthetic real-time candle builder from Swissquote ticks.
"""

import time
import math
import random
import requests
from typing import List, Dict, Any, Optional

# ──────────────────────────────────────────────────────────
# Swissquote Public BBO Endpoint
# ──────────────────────────────────────────────────────────
SWISSQUOTE_XAUUSD_URL = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD"

class GoldDataProvider:
    def __init__(self):
        self.cached_candles: Dict[str, List[Dict[str, Any]]] = {}
        self.last_fetch_time: Dict[str, float] = {}
        self.cache_ttl = 12  # seconds
        self.simulated_candles = self._generate_seed_candles()
        # Track session-level high/low
        self._session_open_price: Optional[float] = None
        self._session_high: Optional[float] = None
        self._session_low: Optional[float] = None
        # Cache the latest Swissquote mid price for offset correction
        self._latest_swissquote_price: Optional[float] = None
        # Synthetic candle builder: accumulates Swissquote ticks into candles
        self._tick_history: List[Dict[str, Any]] = []  # list of {time, price}

    # ──────────────────────────────────────────────────────
    # Swissquote BBO fetch (reusable helper)
    # ──────────────────────────────────────────────────────
    def _fetch_swissquote_bbo(self) -> Optional[Dict[str, Any]]:
        """Fetch raw Swissquote BBO data. Returns best bid/ask/mid or None."""
        try:
            r = requests.get(SWISSQUOTE_XAUUSD_URL, timeout=4, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            })
            if r.status_code == 200:
                entries = r.json()
                best = None
                for entry in entries:
                    profiles = entry.get("spreadProfilePrices", [])
                    for pref in ("elite", "prime", "premium", "standard"):
                        for p in profiles:
                            if p.get("spreadProfile") == pref:
                                best = p
                                break
                        if best:
                            break
                    if best:
                        break
                if best:
                    bid = float(best["bid"])
                    ask = float(best["ask"])
                    mid = round((bid + ask) / 2, 2)
                    spread = round(ask - bid, 3)
                    platform = entries[0].get("topo", {}).get("platform", "Swissquote")
                    server = entries[0].get("topo", {}).get("server", "Live")
                    ts_ms = entries[0].get("ts", int(time.time() * 1000))
                    return {
                        "bid": bid, "ask": ask, "mid": mid, "spread": spread,
                        "platform": platform, "server": server, "ts_ms": ts_ms,
                        "profile": best.get("spreadProfile", "unknown")
                    }
        except Exception:
            pass
        return None

    # ──────────────────────────────────────────────────────
    # Live Price (Primary: Swissquote)
    # ──────────────────────────────────────────────────────
    def get_live_price(self) -> Dict[str, Any]:
        """Fetch current live XAU/USD price from Swissquote BBO feed, with fallbacks."""

        # ── PRIMARY: Swissquote ──
        sq = self._fetch_swissquote_bbo()
        if sq:
            mid = sq["mid"]
            self._latest_swissquote_price = mid

            # Record tick for synthetic candle building
            self._record_tick(mid)

            # Track intra-session high/low
            if self._session_open_price is None:
                self._session_open_price = mid
            if self._session_high is None or mid > self._session_high:
                self._session_high = mid
            if self._session_low is None or mid < self._session_low:
                self._session_low = mid

            change_pct = round(((mid - self._session_open_price) / self._session_open_price) * 100, 3) if self._session_open_price else 0.0

            return {
                "source": f"Swissquote {sq['platform']} ({sq['server']})",
                "spread_profile": sq["profile"],
                "symbol": "XAU/USD",
                "bid": sq["bid"],
                "ask": sq["ask"],
                "spread": sq["spread"],
                "price": mid,
                "change_24h_percent": change_pct,
                "high_24h": self._session_high,
                "low_24h": self._session_low,
                "volume": 0,
                "timestamp": int(sq["ts_ms"] / 1000),
                "market_status": "OPEN (Swissquote Live Feed)"
            }

        # ── FALLBACK 1: Binance PAXGUSDT ──
        try:
            r = requests.get('https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT', timeout=3)
            if r.status_code == 200:
                data = r.json()
                price = float(data['lastPrice'])
                self._latest_swissquote_price = price
                self._record_tick(price)
                return {
                    "source": "PAXG/USDT (Binance – Swissquote Fallback)",
                    "symbol": "XAU/USD",
                    "price": round(price, 2),
                    "change_24h_percent": round(float(data['priceChangePercent']), 2),
                    "high_24h": round(float(data['highPrice']), 2),
                    "low_24h": round(float(data['lowPrice']), 2),
                    "volume": round(float(data['volume']), 2),
                    "timestamp": int(time.time()),
                    "market_status": "OPEN (Binance Fallback)"
                }
        except Exception:
            pass

        # ── FALLBACK 2: Yahoo Finance GC=F ──
        try:
            r = requests.get(
                'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d',
                headers={'User-Agent': 'Mozilla/5.0'}, timeout=4
            )
            if r.status_code == 200:
                data = r.json()['chart']['result'][0]
                meta = data['meta']
                price = float(meta.get('regularMarketPrice', 0))
                prev_close = float(meta.get('chartPreviousClose', price))
                change_pct = ((price - prev_close) / prev_close) * 100 if prev_close else 0.0
                return {
                    "source": "COMEX Gold Futures (Yahoo – Swissquote Fallback)",
                    "symbol": "XAU/USD",
                    "price": round(price, 2),
                    "change_24h_percent": round(change_pct, 2),
                    "high_24h": round(meta.get('regularMarketDayHigh', price + 15), 2),
                    "low_24h": round(meta.get('regularMarketDayLow', price - 15), 2),
                    "volume": meta.get('regularMarketVolume', 125000),
                    "timestamp": int(time.time()),
                    "market_status": "OPEN (Yahoo Fallback)"
                }
        except Exception:
            pass

        # ── FALLBACK 3: Simulation ──
        last_candle = self.simulated_candles[-1]
        noise = (random.random() - 0.49) * 0.8
        sim_price = round(last_candle['close'] + noise, 2)
        return {
            "source": "Simulation Engine (Swissquote Offline)",
            "symbol": "XAU/USD (Sim)",
            "price": sim_price,
            "change_24h_percent": 0.45,
            "high_24h": round(sim_price + 22.5, 2),
            "low_24h": round(sim_price - 18.2, 2),
            "volume": 84520,
            "timestamp": int(time.time()),
            "market_status": "SIMULATION MODE"
        }

    # ──────────────────────────────────────────────────────
    # Tick recording for synthetic candle building
    # ──────────────────────────────────────────────────────
    def _record_tick(self, price: float):
        """Record a price tick for building synthetic candles."""
        now = int(time.time())
        self._tick_history.append({"time": now, "price": price})
        # Keep last 2 hours of ticks (max ~1800 entries at 4s polling)
        cutoff = now - 7200
        self._tick_history = [t for t in self._tick_history if t["time"] >= cutoff]

    def _build_synthetic_candles(self, interval_secs: int, count: int) -> List[Dict[str, Any]]:
        """Build candles from recorded Swissquote ticks."""
        if len(self._tick_history) < 2:
            return []

        now = int(time.time())
        candles = []

        for i in range(count):
            candle_end = now - i * interval_secs
            candle_start = candle_end - interval_secs
            ticks_in_window = [t for t in self._tick_history
                               if candle_start <= t["time"] < candle_end]
            if not ticks_in_window:
                continue
            prices = [t["price"] for t in ticks_in_window]
            candles.append({
                "time": candle_start,
                "open": prices[0],
                "high": max(prices),
                "low": min(prices),
                "close": prices[-1],
                "volume": len(prices) * 100
            })

        candles.reverse()
        return candles

    # ──────────────────────────────────────────────────────
    # Candlestick data (Yahoo + offset correction to match Swissquote)
    # ──────────────────────────────────────────────────────
    def get_candles(self, timeframe: str = "15m", count: int = 100) -> List[Dict[str, Any]]:
        """Fetch candlestick history, corrected to align with Swissquote spot price."""
        now = time.time()
        cache_key = f"{timeframe}_{count}"
        if cache_key in self.cached_candles and (now - self.last_fetch_time.get(cache_key, 0) < self.cache_ttl):
            return self.cached_candles[cache_key]

        # Map timeframe to Yahoo interval and range
        tf_map = {
            "1m": ("1m", "1d"),
            "5m": ("5m", "2d"),
            "15m": ("15m", "5d"),
            "30m": ("30m", "5d"),
            "1h": ("60m", "1mo"),
            "4h": ("60m", "3mo"),
            "1d": ("1d", "6mo")
        }
        interval, time_range = tf_map.get(timeframe, ("15m", "5d"))

        candles = []
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval={interval}&range={time_range}"
            r = requests.get(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }, timeout=5)
            if r.status_code == 200:
                data = r.json()['chart']['result'][0]
                timestamps = data['timestamp']
                quote = data['indicators']['quote'][0]
                opens = quote['open']
                highs = quote['high']
                lows = quote['low']
                closes = quote['close']
                volumes = quote.get('volume', [1000] * len(timestamps))

                for i in range(len(timestamps)):
                    if (opens[i] is not None and highs[i] is not None and
                        lows[i] is not None and closes[i] is not None):
                        candles.append({
                            "time": int(timestamps[i]),
                            "open": round(float(opens[i]), 2),
                            "high": round(float(highs[i]), 2),
                            "low": round(float(lows[i]), 2),
                            "close": round(float(closes[i]), 2),
                            "volume": int(volumes[i] or 1000)
                        })

                if candles:
                    # If 4h requested, aggregate 1h candles
                    if timeframe == "4h":
                        candles = self._aggregate_candles(candles, 4)

                    # ── OFFSET CORRECTION ──
                    # Yahoo GC=F (futures) often differs from XAU/USD spot by $10-$20.
                    # We correct all candle prices so the last close matches the
                    # current Swissquote spot mid-price.
                    if self._latest_swissquote_price and candles:
                        yahoo_last_close = candles[-1]["close"]
                        offset = self._latest_swissquote_price - yahoo_last_close
                        # Only apply correction if the gap is meaningful (> $1)
                        if abs(offset) > 1.0:
                            for c in candles:
                                c["open"] = round(c["open"] + offset, 2)
                                c["high"] = round(c["high"] + offset, 2)
                                c["low"] = round(c["low"] + offset, 2)
                                c["close"] = round(c["close"] + offset, 2)

                    candles = candles[-count:]

                    # ── APPEND LIVE SYNTHETIC CANDLE ──
                    # If we have recent Swissquote ticks, append a live candle
                    # for the current incomplete period
                    live_candle = self._make_live_candle(timeframe, candles)
                    if live_candle:
                        candles.append(live_candle)

                    self.cached_candles[cache_key] = candles
                    self.last_fetch_time[cache_key] = now
                    return candles
        except Exception:
            pass

        # If live fetch fails, use simulated candles
        candles = self._generate_dynamic_candles(timeframe, count)
        self.cached_candles[cache_key] = candles
        self.last_fetch_time[cache_key] = now
        return candles

    def _make_live_candle(self, timeframe: str, existing_candles: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Create a live (incomplete) candle from recent Swissquote ticks."""
        if not self._latest_swissquote_price or not existing_candles:
            return None

        interval_secs = {
            "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400
        }.get(timeframe, 900)

        last_candle_time = existing_candles[-1]["time"]
        now = int(time.time())
        next_candle_start = last_candle_time + interval_secs

        # Only create if we're past the start of the next candle period
        if now < next_candle_start:
            return None

        # Gather ticks since next_candle_start
        ticks = [t for t in self._tick_history if t["time"] >= next_candle_start]
        if ticks:
            prices = [t["price"] for t in ticks]
            return {
                "time": next_candle_start,
                "open": prices[0],
                "high": max(prices),
                "low": min(prices),
                "close": prices[-1],
                "volume": len(prices) * 100
            }
        else:
            # No ticks yet, create a flat candle at current price
            p = self._latest_swissquote_price
            return {
                "time": next_candle_start,
                "open": p,
                "high": p + 0.5,
                "low": p - 0.5,
                "close": p,
                "volume": 100
            }

    def _generate_seed_candles(self) -> List[Dict[str, Any]]:
        """Generate realistic base gold candles."""
        base_price = 2740.0
        now = int(time.time())
        candles = []
        curr = base_price

        for i in range(120):
            t = now - (120 - i) * 900
            trend = math.sin(i / 10.0) * 4.0
            noise = (random.random() - 0.48) * 6.0
            change = trend + noise
            open_p = curr
            close_p = curr + change
            high_p = max(open_p, close_p) + random.random() * 3.5
            low_p = min(open_p, close_p) - random.random() * 3.5
            vol = int(random.uniform(2000, 15000))

            candles.append({
                "time": t,
                "open": round(open_p, 2),
                "high": round(high_p, 2),
                "low": round(low_p, 2),
                "close": round(close_p, 2),
                "volume": vol
            })
            curr = close_p
        return candles

    def _generate_dynamic_candles(self, timeframe: str, count: int) -> List[Dict[str, Any]]:
        interval_secs = {
            "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400
        }.get(timeframe, 900)

        now = int(time.time())
        candles = []
        curr = self._latest_swissquote_price or 2735.0

        for i in range(count):
            t = now - (count - i) * interval_secs
            wave = math.sin(i / 7.0) * 8.0 + math.cos(i / 15.0) * 12.0
            delta = wave * 0.3 + (random.random() - 0.49) * 5.0
            open_p = curr
            close_p = curr + delta
            high_p = max(open_p, close_p) + random.random() * 4.0
            low_p = min(open_p, close_p) - random.random() * 4.0
            vol = int(random.uniform(3000, 25000))

            candles.append({
                "time": t,
                "open": round(open_p, 2),
                "high": round(high_p, 2),
                "low": round(low_p, 2),
                "close": round(close_p, 2),
                "volume": vol
            })
            curr = close_p
        return candles

    def _aggregate_candles(self, candles: List[Dict[str, Any]], factor: int) -> List[Dict[str, Any]]:
        aggregated = []
        for i in range(0, len(candles), factor):
            group = candles[i:i + factor]
            if not group:
                continue
            agg_candle = {
                "time": group[0]["time"],
                "open": group[0]["open"],
                "high": max(c["high"] for c in group),
                "low": min(c["low"] for c in group),
                "close": group[-1]["close"],
                "volume": sum(c["volume"] for c in group)
            }
            aggregated.append(agg_candle)
        return aggregated
