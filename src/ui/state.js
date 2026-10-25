import { DEFAULT_SETTINGS } from "../../shared/indicators.js";
export const createState = () => ({
  date: "",
  page: "market",
  view: "all",
  sector: "all",
  query: "",
  sort: "entryScore",
  sortDirection: -1,
  favorites: [],
  sectorWindow: "day",
  sectorSort: "name-asc",
  sectorName: null,
  settings: { ...DEFAULT_SETTINGS },
  theme: "light",
});
