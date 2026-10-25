import { expandStock, shardOf, SHARD_COUNT, validSymbol } from "../../shared/market-codec.js";
import { getSnapshot, getStockInstitutionEstimate, getStockInstitutionSeries,
  getDominantInstitution, getInstitutionNet } from "../../shared/indicators.js";
import { calculateMarketSentiment } from "../../shared/sentiment.js";
import { entryScoreSummary, getEntryScore } from "../../shared/entry-score.js";
import { DEFAULT_SETTINGS } from "../../shared/indicators.js";
import { compareResearchSnapshots, researchConfigId, researchSnapshot } from "../../shared/research-tracking.js";
import { reviewEventTimeline } from "../../shared/research-review.js";
import { getSectorDetail, getSectorOverview } from "../../shared/sectors.js";
import { DomainError } from "../../shared/domain-error.js";

const WINDOWS = ["day", "5", "20"];
const INSTITUTIONS = ["total", "外資", "投信", "自營商"];

export class MarketSummaryService {
  constructor(market, actions = null, research = null) {
    this.market = market; this.actions = actions; this.researchStore = research;
  }

  async snapshots(date, settings, sector, symbols) {
    const manifest = await this.market.market();
    const asOf = date || manifest.asOf;
    if (!manifest.dates.includes(asOf)) throw new DomainError("INVALID_QUERY", "交易日不存在");
    const dates = manifest.dates.filter((day) => day <= asOf);
    const metadata = sector ? manifest.stocks.filter((stock) => stock.sector === sector) :
      symbols ? manifest.stocks.filter((stock) => symbols.includes(stock.symbol)) : manifest.stocks;
    if (sector && !metadata.length) throw new DomainError("SECTOR_NOT_FOUND", "產業不存在");
    const indices = sector || symbols ? [...new Set(metadata.map((stock) => shardOf(stock.symbol)))] :
      Array.from({ length: SHARD_COUNT }, (_, index) => index);
    const compact = new Map();
    const shards = await this.market.shards(manifest.generation, indices);
    if (shards.length !== indices.length) throw new DomainError("DATA_UNAVAILABLE", "市場資料分片不完整");
    const seen = new Set();
    for (const shard of shards) {
      if (shard.generation !== manifest.generation || !indices.includes(shard.index) || seen.has(shard.index))
        throw new DomainError("DATA_UNAVAILABLE", "市場資料版本不一致");
      seen.add(shard.index);
      for (const stock of shard.stocks) compact.set(stock.symbol, stock.history);
    }
    const stocks = metadata.map((stock) => {
      const rows = compact.get(stock.symbol);
      if (!rows) throw new DomainError("DATA_UNAVAILABLE", "市場資料不完整");
      const snapshot = getSnapshot({ ...expandStock(stock, rows), tradingDates: dates }, asOf, settings);
      // The 20-session sentiment series needs 60 closes at its oldest point.
      snapshot.history = snapshot.history.slice(-80);
      return snapshot;
    });
    return { manifest, asOf, dates, stocks };
  }

  async summary(date, settings) {
    const { manifest, asOf, dates, stocks } = await this.snapshots(date, settings);
    const actions = this.actions ? await this.actions.window(dates.slice(-61)) : null;
    const capture = Boolean(this.researchStore && asOf === manifest.asOf &&
      Object.keys(DEFAULT_SETTINGS).every((key) => settings[key] === DEFAULT_SETTINGS[key]));
    const capturedAt = capture ? new Date().toISOString() : null;
    const revisionId = capture ? `${manifest.generation}:${this.actions ? await this.actions.revision() : "no-actions"}` : null;
    const researchRows = [];
    const data = stocks.map((stock) => ({
      symbol: stock.symbol, name: stock.name, sector: stock.sector, market: stock.market,
      assetType: stock.assetType, currency: stock.currency, listedOn: stock.listedOn,
      latest: stock.latest, signal: stock.signal, priceVolume: stock.priceVolume,
      trend: stock.trend, entryScore: (() => {
        const score = getEntryScore(stock, dates, asOf,
          { priceBasis: "unadjusted", corporateActions: actions });
        if (capture) researchRows.push(researchSnapshot(score, { symbol: stock.symbol,
          market: stock.market, asOf, capturedAt, generation: manifest.generation,
          revisionId, settings }));
        return entryScoreSummary(score);
      })(),
      dominantInstitution: getDominantInstitution(stock.latest?.institutions),
      money: { day: { total: getStockInstitutionEstimate(stock, "total", "day", dates) } },
    }));
    const sectors = Object.fromEntries(WINDOWS.map((window) => [window,
      getSectorOverview(stocks, { window, sort: "net-desc", tradingDates: dates, asOf })
        .map(({ stocks: _stocks, leader, ...sector }) => ({ ...sector,
          leader: leader ? { symbol: leader.symbol, name: leader.name } : null }))]));
    if (capture) {
      try { await this.researchStore.save({ asOf, modelVersion: researchRows[0].modelVersion,
        configId: researchConfigId(settings), revisionId, capturedAt, snapshots: researchRows }); }
      catch (error) { console.error("Research snapshot capture failed", error); }
    }
    return { data: { stocks: data, sentiment: calculateMarketSentiment(stocks, asOf, 20, dates, actions), sectors },
      meta: { asOf, sourceAsOf: manifest.asOf, generation: manifest.generation,
        rulesVersion: "technical-v1", settings } };
  }

  async research(symbols, date, settings) {
    if (!this.researchStore) throw new DomainError("DATA_UNAVAILABLE", "研究快照資料庫尚未啟用");
    if (!Array.isArray(symbols) || !symbols.length || symbols.length > 50 ||
        new Set(symbols).size !== symbols.length || symbols.some((symbol) => !validSymbol(symbol)))
      throw new DomainError("INVALID_QUERY", "自選股票代號無效");
    const manifest = await this.market.market();
    const asOf = date || manifest.asOf;
    const index = manifest.dates.indexOf(asOf);
    if (index < 0 || index < manifest.dates.length - 30)
      throw new DomainError("INVALID_QUERY", "研究快照查詢限最近 30 個市場交易日");
    const known = new Set(manifest.stocks.map(({ symbol }) => symbol));
    if (symbols.some((symbol) => !known.has(symbol))) throw new DomainError("INVALID_QUERY", "股票不在上市清單");
    const previousDate = manifest.dates[index - 1] ?? null;
    const configId = researchConfigId(settings);
    const historyDates = manifest.dates.slice(Math.max(0, index - 29), index + 1);
    const [today, previous, history, revisions] = await Promise.all([
      this.researchStore.latest(asOf, configId, symbols),
      previousDate ? this.researchStore.latest(previousDate, configId, symbols)
        : Promise.resolve({ revision: null, snapshots: new Map() }),
      this.researchStore.history(historyDates, configId, symbols),
      this.researchStore.revisions(asOf, configId),
    ]);
    return { data: symbols.map((symbol) => {
      const latest = today.snapshots.get(symbol) ?? null;
      const prior = previous.snapshots.get(symbol) ?? null;
      const comparison = compareResearchSnapshots(latest, prior, previousDate);
      const series = historyDates.map((day) => (history.get(symbol) ?? []).find((item) => item.asOf === day) ??
        { asOf: day, valid: false });
      const timeline = reviewEventTimeline(series, historyDates);
      return { symbol, latest, previous: prior, comparison, events: comparison.events,
        history: series, timeline };
    }), meta: { asOf, previousDate, configId, latestRevision: today.revision,
      previousRevision: previous.revision, revisions, source: "saved", coverage: today.revision?.stockCount ?? 0 } };
  }

  async favorites(symbols, date, settings) {
    if (!Array.isArray(symbols) || !symbols.length || symbols.length > 50 ||
        new Set(symbols).size !== symbols.length || symbols.some((symbol) => !validSymbol(symbol)))
      throw new DomainError("INVALID_QUERY", "自選股票代號無效");
    const { manifest, asOf, dates, stocks } = await this.snapshots(date, settings, null, symbols);
    if (stocks.length !== symbols.length) throw new DomainError("INVALID_QUERY", "自選股票不在上市清單");
    return { data: stocks.map((stock) => ({ symbol: stock.symbol,
      institutionalSummary: stock.institutionalSummary,
      dayInstitutionNet: Object.fromEntries(INSTITUTIONS.map((name) => [name,
        name === "total" ? stock.latest?.institutionalNet ?? null :
          getInstitutionNet(stock.latest?.institutions, name)])),
      money: Object.fromEntries(WINDOWS.map((window) => [window,
        Object.fromEntries(INSTITUTIONS.map((name) => [name,
          getStockInstitutionEstimate(stock, name, window, dates)]))])),
      institutionSeries: getStockInstitutionSeries(stock, dates),
    })), meta: { asOf, generation: manifest.generation, rulesVersion: "technical-v1" } };
  }

  async sector(name, date, settings) {
    const { manifest, asOf, dates, stocks } = await this.snapshots(date, settings, name);
    const detail = getSectorDetail(stocks, name, { tradingDates: dates, asOf });
    if (!detail) throw new DomainError("SECTOR_NOT_FOUND", "產業不存在");
    return { data: { ...detail, stocks: undefined,
      members: detail.members.map(({ stock, ...member }) => ({ ...member,
        stock: { symbol: stock.symbol, name: stock.name, latest: stock.latest,
          institutionSeries: getStockInstitutionSeries(stock, dates) } })) },
      meta: { asOf, generation: manifest.generation, rulesVersion: "technical-v1" } };
  }
}
