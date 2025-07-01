import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const existingEpisode = await prisma.episode.findFirst({
            where: {
                AND: [
                    { tvSeriesId: body.tvSeriesId },
                    { seasonNumber: body.seasonNumber },
                    { episodeNumber: body.episodeNumber }
                ]
            }
        });

        if (existingEpisode) {
            return NextResponse.json(
                { error: "Episode already exists for this season" },
                { status: 409 }
            );
        }

        const episode = await prisma.episode.create({
            data: {
                title: body.title,
                seasonNumber: parseInt(body.seasonNumber),
                episodeNumber: parseInt(body.episodeNumber),
                tvSeriesId: body.tvSeriesId,
            }
        });

        return NextResponse.json(episode);
    } catch (error) {
        console.error("Failed to create episode:", error);
        return NextResponse.json(
            { error: "Failed to create episode" },
            { status: 500 }
        );
    }
}