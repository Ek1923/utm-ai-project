"""
NEXUS Trading Data Collector
Fetches live market data and generates training examples for APEX-2 and TACTIX.
Run: python collect_trading_data.py [apex2|tactix|both]
"""
import os
import sys
import json
import time
import random
import urllib.request
from datetime import datetime, timezone

ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA_ROOT = os.path.join(ROOT, 'data', 'agents')

COINS = [
    ('bitcoin', 'BTC'),
    ('ethereum', 'ETH'),
    ('solana', 'SOL'),
    ('binancecoin', 'BNB'),
    ('avalanche-2', 'AVAX'),
    ('chainlink', 'LINK'),
]


def log(msg: str):
    print(msg, flush=True)


def fetch_json(url: str, timeout: int = 15) -> dict | list | None:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'NEXUS-Collector/1.0'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f'[WARN] fetch failed {url}: {e}')
        return None


def fetch_market_data() -> list[dict]:
    ids = ','.join(c[0] for c in COINS)
    url = (
        f'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd'
        f'&ids={ids}&order=market_cap_desc&per_page=10&page=1'
        f'&sparkline=false&price_change_percentage=24h'
    )
    data = fetch_json(url)
    if not data:
        return []
    return data


def generate_apex2_example(coin: dict) -> dict:
    sym   = coin.get('symbol', '').upper()
    price = coin.get('current_price', 0)
    chg   = coin.get('price_change_percentage_24h', 0)
    high  = coin.get('high_24h', price * 1.02)
    low   = coin.get('low_24h', price * 0.98)
    vol   = coin.get('total_volume', 0) / 1e9
    mcap  = coin.get('market_cap', 0) / 1e9
    dir_  = '▲' if chg >= 0 else '▼'

    # Derive simple technical signals from available data
    range_pct   = ((high - low) / low * 100) if low > 0 else 0
    price_pos   = (price - low) / (high - low) if high != low else 0.5

    if chg > 3 and price_pos > 0.7:
        trend, signal, conf = 'Strong Bullish', 'BUY', random.randint(72, 85)
    elif chg > 1:
        trend, signal, conf = 'Bullish', 'BUY', random.randint(62, 74)
    elif chg < -3 and price_pos < 0.3:
        trend, signal, conf = 'Strong Bearish', 'SELL', random.randint(70, 82)
    elif chg < -1:
        trend, signal, conf = 'Bearish', 'SELL', random.randint(60, 72)
    else:
        trend, signal, conf = 'Sideways', 'HOLD', random.randint(50, 65)

    entry  = round(price * (0.99 if signal == 'BUY' else 1.01), 2)
    target = round(price * (1.07 if signal == 'BUY' else 0.93), 2)
    sl     = round(price * (0.95 if signal == 'BUY' else 1.05), 2)
    rr     = round(abs(target - entry) / abs(entry - sl), 1) if sl != entry else 1.0

    prompt = (
        f'Analyze the following market data:\n'
        f'Symbol: {sym}/USD\n'
        f'Price: ${price:,.2f}\n'
        f'24h Change: {dir_} {abs(chg):.2f}%\n'
        f'24h High: ${high:,.2f}\n'
        f'24h Low: ${low:,.2f}\n'
        f'Volume 24h: ${vol:.2f}B\n'
        f'Market Cap: ${mcap:.1f}B'
    )

    support  = round(low * 0.98, 2)
    resist   = round(high * 1.02, 2)
    response = (
        f'TREND: {trend}\n'
        f'MOMENTUM: {"Strong" if abs(chg) > 3 else "Moderate"} — '
        f'range {range_pct:.1f}%, price at {price_pos*100:.0f}% of daily range\n'
        f'KEY LEVELS: Support ${support:,.2f}, Resistance ${resist:,.2f}\n'
        f'SIGNAL: {signal}\n'
        f'ENTRY: ${entry:,.2f}\n'
        f'TARGET: ${target:,.2f} ({abs((target-price)/price*100):.1f}% {"upside" if signal=="BUY" else "downside"})\n'
        f'STOP LOSS: ${sl:,.2f}\n'
        f'RISK/REWARD: 1:{rr}\n'
        f'CONFIDENCE: {conf}%'
    )
    return {'prompt': prompt, 'response': response}


def generate_tactix_example(coin: dict, apex2_resp: str) -> dict:
    sym   = coin.get('symbol', '').upper()
    price = coin.get('current_price', 0)
    chg   = coin.get('price_change_percentage_24h', 0)
    mcap  = coin.get('market_cap', 0) / 1e9
    vol   = coin.get('total_volume', 0) / 1e9
    dir_  = '▲' if chg >= 0 else '▼'

    macro = 'stable' if abs(chg) < 2 else ('positive' if chg > 0 else 'negative')
    alloc = 20 if chg > 3 else (15 if chg > 0 else 10)

    prompt = (
        f'APEX-2 Analysis:\n{apex2_resp}\n\n'
        f'Market Data:\nSymbol: {sym}/USD\nPrice: ${price:,.2f}\n'
        f'24h Change: {dir_} {abs(chg):.2f}%\nMarket Cap: ${mcap:.1f}B\n\n'
        f'Provide your strategic trading recommendation.'
    )

    response = (
        f'MACRO ASSESSMENT: Market environment {macro} — '
        f'{sym} showing {"strength" if chg > 0 else "weakness"} relative to sector.\n\n'
        f'SIGNAL VALIDATION: {"Confirmed" if chg > 0 else "Cautious"} — '
        f'technical signal aligns with {"positive" if chg > 0 else "risk-off"} macro backdrop.\n\n'
        f'POSITION SIZE: {alloc}% of crypto allocation '
        f'({"increase" if chg > 2 else "maintain" if chg > 0 else "reduce"} from baseline).\n\n'
        f'EXECUTION PLAN:\n'
        f'1. Open 40% of position at market (${price:,.2f})\n'
        f'2. Scale in 35% on {"dip to" if chg > 0 else "bounce at"} '
        f'${price * (0.97 if chg > 0 else 1.03):,.2f}\n'
        f'3. Reserve 25% for extreme move opportunity\n\n'
        f'RISK RULES:\n'
        f'- Hard stop: APEX-2 stop loss level\n'
        f'- Take 50% profits at APEX-2 target\n'
        f'- Trail stop after target hit\n'
        f'- Do not add to losing position\n\n'
        f'DAILY OUTLOOK: {"Bullish bias — look for long entries on dips." if chg > 1 else "Cautious — wait for clear direction before sizing up."}'
    )
    return {'prompt': prompt, 'response': response}


def save_examples(agent: str, examples: list[dict]):
    out_dir = os.path.join(DATA_ROOT, agent)
    os.makedirs(out_dir, exist_ok=True)
    date    = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')
    outfile = os.path.join(out_dir, f'auto_market_{date}.jsonl')
    with open(outfile, 'w', encoding='utf-8') as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + '\n')
    log(f'✅ {len(examples)} voorbeelden opgeslagen → {outfile}')


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else 'both'
    log(f'🔄 Datacollectie gestart voor: {target}')
    log('📡 Live marktdata ophalen van CoinGecko...')

    coins = fetch_market_data()
    if not coins:
        log('❌ Kon geen marktdata ophalen. Controleer je internetverbinding.')
        sys.exit(1)

    log(f'✅ {len(coins)} munten opgehaald')
    time.sleep(1)

    apex2_examples  = []
    tactix_examples = []

    for coin in coins:
        sym = coin.get('symbol', '').upper()
        log(f'  → Verwerk {sym}...')

        apex2_ex = generate_apex2_example(coin)
        apex2_examples.append(apex2_ex)

        tactix_ex = generate_tactix_example(coin, apex2_ex['response'])
        tactix_examples.append(tactix_ex)

        time.sleep(0.2)

    if target in ('apex2', 'both'):
        log(f'\n💾 APEX-2 data opslaan ({len(apex2_examples)} voorbeelden)...')
        save_examples('apex2', apex2_examples)

    if target in ('tactix', 'both'):
        log(f'💾 TACTIX data opslaan ({len(tactix_examples)} voorbeelden)...')
        save_examples('tactix', tactix_examples)

    log('\n✅ Datacollectie voltooid!')
    log(f'   APEX-2: {len(apex2_examples)} nieuwe voorbeelden')
    log(f'   TACTIX: {len(tactix_examples)} nieuwe voorbeelden')
    log('🔁 Druk op TRAIN in de Trade pagina om te hertrainen.')


if __name__ == '__main__':
    main()
