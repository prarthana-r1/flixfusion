// import dotenv from 'dotenv';

// dotenv.config({ path: '.env.local' });

import { createClient } from 'redis';
import { SearchResults } from '@/types/search';
import { SEARCH_CONSTANTS } from './constant';
import prisma from "@/lib/prisma";

const client = createClient({
    password: process.env.REDIS_PASSWORD || '',
    socket: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '10950')
    }
});

client.connect().catch((err) => {
    console.error('Redis connection error:', err);
});

client.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

const generateCacheKey = (query: string, type: string): string => {
    return `search:${type}:${query.toLowerCase()}`;
};

export async function getCachedSearchResults(query: string, type: string): Promise<SearchResults | null> {
    const cacheKey = generateCacheKey(query, type);
    
    try {
        const cachedData = await client.get(cacheKey);
        if (cachedData) {
            return JSON.parse(cachedData);
        }
        return null;
    } catch (error) {
        console.error('Redis get error:', error);
        return null;
    }
}

export async function setCachedSearchResults(
    query: string, 
    type: string, 
    results: SearchResults
): Promise<void> {
    const cacheKey = generateCacheKey(query, type);
    
    try {
        await client.set(
            cacheKey, 
            JSON.stringify(results), 
            {
                EX: SEARCH_CONSTANTS.CACHE_TIME
            }
        );
    } catch (error) {
        console.error('Redis set error:', error);
    }
}

export async function clearSearchCache(query: string, type: string): Promise<void> {
    const cacheKey = generateCacheKey(query, type);
    
    try {
        await client.del(cacheKey);
    } catch (error) {
        console.error('Redis delete error:', error);
    }
}

export async function clearAllSearchCaches(): Promise<void> {
    try {
        const keys = await client.keys('search:*');
        if (keys.length > 0) {
            await client.del(keys);
        }
    } catch (error) {
        console.error('Redis clear all error:', error);
    }
}

export async function getSearchResults(
    query: string,
    type: string
): Promise<SearchResults> {
    if (!query) return { movies: [], tvSeries: [], episodes: [] };

    try {
        const cachedResults = await getCachedSearchResults(query, type);
        if (cachedResults) {
            console.log('Cache hit for:', query, type);
            return cachedResults;
        }

        console.log('Cache miss for:', query, type);

        const searchCondition = {
            contains: query,
            mode: 'insensitive' as const
        };


        // Movies
        const movies = (type === "all" || type === "movie") ?
            await prisma.movie.findMany({
                where: {
                    OR: [
                        { title: searchCondition },
                        { director: searchCondition }
                    ]
                },
                take: SEARCH_CONSTANTS.RESULTS_PER_PAGE,
                orderBy: { title: 'asc' }
            }) : [];

        // TV Series
        const tvSeriesRaw = (type === "all" || type === "tvSeries") ?
            await prisma.tvSeries.findMany({
                where: {
                    OR: [
                        { title: searchCondition },
                        { director: searchCondition }
                    ]
                },
                take: SEARCH_CONSTANTS.RESULTS_PER_PAGE,
                orderBy: { title: 'asc' }
            }) : [];

        // Add id to each episode in tvSeries
        const tvSeries = tvSeriesRaw.map((series: any) => ({
            ...series,
            episodes: Array.isArray(series.episodes)
                ? series.episodes.map((ep: any) => ({
                    ...ep,
                    id: `${series.id}_${ep.seasonNumber}_${ep.episodeNumber}`
                }))
                : []
        }));

        // Episodes (search inside tvSeries.episodes)

        let episodes: any[] = [];
        if (type === "all" || type === "episode") {
            // Fetch all tvSeries that could contain matching episodes
            const allSeries = await prisma.tvSeries.findMany({ select: { id: true, title: true, episodes: true } });
            for (const series of allSeries) {
                if (Array.isArray(series.episodes)) {
                    const matchedEpisodes = series.episodes.filter((ep: any) =>
                        ep.title && ep.title.toLowerCase().includes(query.toLowerCase())
                    ).map((ep: any) => ({
                        id: `${series.id}_${ep.seasonNumber}_${ep.episodeNumber}`,
                        episodeNumber: ep.episodeNumber,
                        isReference: ep.isReference,
                        seasonNumber: ep.seasonNumber,
                        title: ep.title,
                        tvSeriesTitle: series.title
                    }));
                    episodes.push(...matchedEpisodes);
                }
            }
            // Limit results
            episodes = episodes.slice(0, SEARCH_CONSTANTS.RESULTS_PER_PAGE);
        }

        // Ensure type compatibility for episodes in tvSeries
        const tvSeriesFixed = tvSeries.map((series: any) => ({
            ...series,
            episodes: Array.isArray(series.episodes)
                ? series.episodes.map((ep: any) => ({
                    ...ep,
                    id: ep.id || `${series.id}_${ep.seasonNumber}_${ep.episodeNumber}`
                }))
                : []
        }));


        const searchResults = {
            movies,
            tvSeries: tvSeriesFixed,
            episodes
        };

        await setCachedSearchResults(query, type, searchResults);
        console.log('Cached results for:', query, type);

        return searchResults;
    } catch (error) {
        console.error('Search error:', error);
        throw error;
    }
}

export async function closeRedisConnection(): Promise<void> {
    try {
        await client.quit();
    } catch (error) {
        console.error('Redis disconnect error:', error);
    }
}