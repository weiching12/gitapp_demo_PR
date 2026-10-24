export class ApiError extends Error {
  constructor(message, { status = 0, code = "API_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class HttpClient {
  constructor(fetcher = fetch) { this.fetcher = (...args) => fetcher(...args); }

  async json(path, options = {}) {
    let response;
    try { response = await this.fetcher(path, options); }
    catch (cause) { throw new ApiError("無法連線至資料服務", { cause }); }
    if (!response.ok) {
      let body;
      try { body = await response.clone().json(); } catch { body = null; }
      throw new ApiError(body?.error?.message || "資料服務暫時無法使用", {
        status: response.status, code: body?.error?.code || "HTTP_ERROR",
      });
    }
    try { return { data: await response.json(), response }; }
    catch (cause) { throw new ApiError("資料服務回應格式錯誤", { status: response.status, code: "INVALID_JSON", cause }); }
  }
}
