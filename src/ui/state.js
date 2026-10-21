import { DEFAULT_SETTINGS } from "../../shared/indicators.js";
export const createState = () => ({
  date: "",
  page: "market",
  view: "all",
  sector: "all",
  query: "",
  sort: null,
  sortDirection: -1,
  favorites: [],
  overview: "price",
  institutionWindow: "day",
  sectorWindow: "day",
  sectorSort: "name-asc",
  institutionSymbol: null,
  sectorName: null,
  settings: { ...DEFAULT_SETTINGS },
  theme: "light",
});
