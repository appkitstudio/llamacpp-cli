import * as https from 'https';

export interface HFModelResult {
  modelId: string;
  author: string;
  modelName: string;
  downloads: number;
  likes: number;
  tags: string[];
  lastModified: string;
}

export class ModelSearch {
  /**
   * Search Hugging Face for GGUF models
   */
  async searchModels(query: string, limit = 20): Promise<HFModelResult[]> {
    const searchUrl = this.buildSearchUrl(query, limit);

    return new Promise((resolve, reject) => {
      https.get(searchUrl, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const results = JSON.parse(data);
            const models = this.parseResults(results);
            resolve(models);
          } catch (error) {
            reject(new Error(`Failed to parse search results: ${(error as Error).message}`));
          }
        });
      }).on('error', (error) => {
        reject(new Error(`Search request failed: ${error.message}`));
      });
    });
  }

  /**
   * Build Hugging Face search URL
   */
  private buildSearchUrl(query: string, limit: number): string {
    const params = new URLSearchParams({
      search: query,
      filter: 'gguf',
      sort: 'downloads',
      direction: '-1',
      limit: limit.toString(),
    });

    return `https://huggingface.co/api/models?${params.toString()}`;
  }

  /**
   * Parse API results into our model format
   */
  private parseResults(results: any[]): HFModelResult[] {
    return results.map((result) => {
      const modelId = result.id || result.modelId || '';
      const parts = modelId.split('/');
      const author = parts[0] || '';
      const modelName = parts.slice(1).join('/') || '';

      return {
        modelId,
        author,
        modelName,
        downloads: result.downloads || 0,
        likes: result.likes || 0,
        tags: result.tags || [],
        lastModified: result.lastModified || '',
      };
    });
  }

  /**
   * Get GGUF files for a specific model
   */
  async getModelFiles(modelId: string): Promise<string[]> {
    const apiUrl = `https://huggingface.co/api/models/${modelId}`;

    return new Promise((resolve, reject) => {
      https.get(apiUrl, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const modelInfo = JSON.parse(data);
            const files = modelInfo.siblings || [];
            const ggufFiles = files
              .filter((file: any) => file.rfilename?.toLowerCase().endsWith('.gguf'))
              .map((file: any) => file.rfilename);
            resolve(ggufFiles);
          } catch (error) {
            reject(new Error(`Failed to fetch model files: ${(error as Error).message}`));
          }
        });
      }).on('error', (error) => {
        reject(new Error(`API request failed: ${error.message}`));
      });
    });
  }
}

// Export singleton instance
export const modelSearch = new ModelSearch();
