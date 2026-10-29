// Isolated transactional storage fixture; never connects to a deployed object.
export function durableStorage(data = new Map()) {
  let alarm = null;
  const storage = {
    async get(key) { return structuredClone(data.get(key)); },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async delete(keys) {
      if (!Array.isArray(keys)) return data.delete(keys);
      return keys.reduce((count, key) => count + Number(data.delete(key)), 0);
    },
    async deleteAll() { data.clear(); },
    async setAlarm(time) { alarm = time; },
    async getAlarm() { return alarm; },
    async deleteAlarm() { alarm = null; },
    async transaction(work) {
      const before = structuredClone([...data]);
      const beforeAlarm = alarm;
      try { return await work(storage); }
      catch (error) { data.clear(); for (const [key, value] of before) data.set(key, value); alarm = beforeAlarm; throw error; }
    },
  };
  return storage;
}
