/**
 * JSONBin.io Client for Server-Side Operations
 * Provides a persistent storage solution for JSON data on read-only filesystems
 */

const axios = require('axios');

class JSONBinClient {
  constructor(masterKey, accessKey = null) {
    this.masterKey = masterKey;
    this.accessKey = accessKey;
    this.baseUrl = 'https://api.jsonbin.io/v3';
    this.cache = new Map(); // In-memory cache to reduce API calls
    this.cacheTTL = 30000; // 30 seconds cache TTL
  }

  /**
   * Create a new bin
   * @param {Object} data - JSON data to store
   * @param {String} name - Optional bin name
   * @returns {Promise<Object>} - { binId, metadata }
   */
  async createBin(data, name = null) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-Master-Key': this.masterKey
      };
      if (name) headers['X-Bin-Name'] = name;

      const response = await axios.post(`${this.baseUrl}/b`, data, { headers });
      
      return {
        binId: response.data.metadata.id,
        metadata: response.data.metadata
      };
    } catch (error) {
      throw new Error(`JSONBin create failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Read data from a bin
   * @param {String} binId - Bin ID to read
   * @param {Boolean} useCache - Whether to use cache (default: true)
   * @returns {Promise<Object>} - The stored JSON data
   */
  async readBin(binId, useCache = true) {
    if (!binId) throw new Error('Bin ID is required');

    // Check cache first
    if (useCache) {
      const cached = this.cache.get(binId);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    try {
      const headers = { 'X-Master-Key': this.masterKey };
      const response = await axios.get(`${this.baseUrl}/b/${binId}/latest`, { headers });
      
      const data = response.data.record;
      
      // Update cache
      this.cache.set(binId, {
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Bin not found: ${binId}`);
      }
      throw new Error(`JSONBin read failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Update an existing bin
   * @param {String} binId - Bin ID to update
   * @param {Object} data - New JSON data
   * @returns {Promise<Object>} - { success, metadata }
   */
  async updateBin(binId, data) {
    if (!binId) throw new Error('Bin ID is required');

    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-Master-Key': this.masterKey
      };

      const response = await axios.put(`${this.baseUrl}/b/${binId}`, data, { headers });
      
      // Invalidate cache
      this.cache.delete(binId);

      return {
        success: true,
        metadata: response.data.metadata
      };
    } catch (error) {
      throw new Error(`JSONBin update failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Delete a bin
   * @param {String} binId - Bin ID to delete
   * @returns {Promise<Object>} - { success }
   */
  async deleteBin(binId) {
    if (!binId) throw new Error('Bin ID is required');

    try {
      const headers = { 'X-Master-Key': this.masterKey };
      await axios.delete(`${this.baseUrl}/b/${binId}`, { headers });
      
      // Invalidate cache
      this.cache.delete(binId);

      return { success: true };
    } catch (error) {
      throw new Error(`JSONBin delete failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * List all bins in the account
   * @returns {Promise<Array>} - Array of bin metadata
   */
  async listBins() {
    try {
      const headers = { 'X-Master-Key': this.masterKey };
      const response = await axios.get(`${this.baseUrl}/c`, { headers });
      
      return response.data || [];
    } catch (error) {
      throw new Error(`JSONBin list failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create or update a bin (upsert operation)
   * @param {String} binId - Bin ID (if null, creates new bin)
   * @param {Object} data - JSON data
   * @param {String} name - Optional bin name (only for create)
   * @returns {Promise<Object>} - { binId, created, metadata }
   */
  async upsertBin(binId, data, name = null) {
    if (binId) {
      try {
        const result = await this.updateBin(binId, data);
        return { binId, created: false, ...result };
      } catch (error) {
        // If bin doesn't exist, create it
        if (error.message.includes('not found')) {
          const result = await this.createBin(data, name);
          return { ...result, created: true };
        }
        throw error;
      }
    } else {
      const result = await this.createBin(data, name);
      return { ...result, created: true };
    }
  }

  /**
   * Clear the in-memory cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} - { size, keys }
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

module.exports = JSONBinClient;
