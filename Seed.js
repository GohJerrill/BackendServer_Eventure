// seed.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";

const mainDB = JSON.parse(
    fs.readFileSync("./MainDB.json", "utf-8")
)

console.log("JSON keys:", Object.keys(mainDB));
console.log("Users in JSON:", mainDB.Users?.length);
console.log("Events in JSON:", mainDB.Events?.length);
console.log("RegisteredEvents in JSON:", mainDB.RegisteredEvents?.length);
console.log("BookMarks in JSON:", mainDB.BookMarks?.length);
console.log("ClaimedRewards in JSON:", mainDB.ClaimedRewards?.length);
console.log("Notification in JSON:", mainDB.Notification?.length);


import User from "./Models/UserModel.js";
import Reward from "./Models/RewardsModel.js";
import ClaimedReward from "./Models/ClaimedRewardModel.js";

import Event from "./Models/EventsModel.js";
import RegisteredEvent from "./Models/RegisteredEventModel.js";
import Bookmark from "./Models/BookmarksModel.js";
import Notification from "./Models/NotificationModel.js";
import Badge from "./Models/BadgesModel.js";

dotenv.config();

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Wipe existing data (clean reset)
    await User.deleteMany({});
    await Reward.deleteMany({});
    await ClaimedReward.deleteMany({});
    await Event.deleteMany({});
    await RegisteredEvent.deleteMany({});
    await Bookmark.deleteMany({});
    await Notification.deleteMany({});
    await Badge.deleteMany({});

    // ===== 1. USERS =====
    const userIdMap = new Map(); // "U001" -> ObjectId

    for (const u of mainDB.Users) {
        const userDoc = await User.create({
            username: u.username,
            student_email: u.student_email,
            password: u.password,
            role: u.role,
            profile_image: u.profile_image ?? null,
            points: u.points ?? 0,
            total_points: u.total_points ?? 0,
            badges: []
        });

        userIdMap.set(u.id, userDoc._id);
    }
    console.log("Seeded Users");

    // ===== 2. BADGES =====
    const badgeIdMap = new Map(); // "B1" -> ObjectId

    for (const b of mainDB.Badges) {
        const badgeDoc = await Badge.create({
            name: b.name,
            description: b.description,
            icon_image: b.icon_image,
        });

        badgeIdMap.set(b.id, badgeDoc._id);
    }
    console.log("✅ Seeded Badges");

    // ===== 3. REWARDS =====
    const rewardIdMap = new Map(); // "R001" -> ObjectId

    for (const r of mainDB.Rewards) {
        const rewardDoc = await Reward.create({
            name: r.name,
            cost: r.cost,
            stock: r.stock,
            reward_image: r.reward_image,
            description: r.description,
            reward_email_image: r.reward_email_image,
            email_description: r.email_description,
        });

        rewardIdMap.set(r.id, rewardDoc._id);
    }
    console.log("✅ Seeded Rewards");

    // ===== 4. EVENTS =====
    const eventIdMap = new Map(); // "E001" -> ObjectId

    for (const e of mainDB.Events) {
        const eventDoc = await Event.create({
            title: e.title,
            description: e.description,
            school: e.school,
            category: e.category,
            type: e.type,
            start_date: new Date(e.start_date),
            end_date: new Date(e.end_date),
            status: e.status,
            organiser: e.organiser,
            venue: e.venue,
            attendees: e.attendees ?? 0,
            max_capacity: e.max_capacity,
            points: e.points ?? 0,
            TP_Location: e.TP_Location ?? false,
            image: e.image,
            organiser_image: e.organiser_image,
        });

        eventIdMap.set(e.id, eventDoc._id);
    }
    console.log("✅ Seeded Events");

    // ===== 5. REGISTERED EVENTS =====
    for (const re of mainDB.RegisteredEvents) {
        const userObjectId = userIdMap.get(re.user_id);
        const eventObjectId = eventIdMap.get(re.event_id);

        if (!userObjectId || !eventObjectId) {
            console.warn("⚠️ Skipping RegisteredEvent, missing mapping:", re);
            continue;
        }

        await RegisteredEvent.create({
            user_id: userObjectId,
            event_id: eventObjectId,
            qr_code_ticket: re.qr_code_ticket,
            turn_up: re.turn_up ?? false,
            scanned_at: re.scanned_at ? new Date(re.scanned_at) : null,
            // preserve original registration time
            createdAt: new Date(re.date_registered),
            updatedAt: re.scanned_at
                ? new Date(re.scanned_at)
                : new Date(re.date_registered),
        });
    }
    console.log("✅ Seeded RegisteredEvents");

    // ===== 6. BOOKMARKS =====
    // mainDB key is "BookMarks" (case-sensitive)
    for (const bm of mainDB.BookMarks) {
        const userObjectId = userIdMap.get(bm.user_id);
        const eventObjectId = eventIdMap.get(bm.event_id);

        if (!userObjectId || !eventObjectId) {
            console.warn("⚠️ Skipping Bookmark, missing mapping:", bm);
            continue;
        }

        await Bookmark.create({
            user: userObjectId,
            event: eventObjectId,
            // timestamps will auto-set createdAt/updatedAt
        });
    }
    console.log("✅ Seeded Bookmarks");

    // ===== 7. CLAIMED REWARDS =====
    for (const cr of mainDB.ClaimedRewards) {
        const userObjectId = userIdMap.get(cr.user_id);
        const rewardObjectId = rewardIdMap.get(cr.reward_id);

        if (!userObjectId || !rewardObjectId) {
            console.warn("⚠️ Skipping ClaimedReward, missing mapping:", cr);
            continue;
        }

        await ClaimedReward.create({
            user: userObjectId,
            reward: rewardObjectId,
            createdAt: new Date(cr.date_redeemed),
            updatedAt: new Date(cr.date_redeemed),
        });
    }
    console.log("✅ Seeded ClaimedRewards");

    // ===== 8. NOTIFICATIONS =====
    for (const n of mainDB.Notification) {
        const userObjectId = userIdMap.get(n.user_id);
        if (!userObjectId) {
            console.warn("⚠️ Skipping Notification (no user mapping):", n);
            continue;
        }

        let eventObjectId = null;
        if (n.event_id) {
            eventObjectId = eventIdMap.get(n.event_id) ?? null;
        }

        const notifData = {
            user: userObjectId,
            type: n.type,
            message: n.message,
            is_read: n.is_read ?? false,
            icon: n.Icon,
            createdAt: new Date(n.created_at),
            updatedAt: new Date(n.created_at),
        };

        if (n.type === "Event" && eventObjectId) {
            notifData.event = eventObjectId;
        }

        if (n.type === "Points" && n.points_added != null) {
            notifData.points_added = Number(n.points_added);
        }

        // If you later have "Badges" notifications with badge_id:
        // if (n.type === "Badges" && n.badge_id) {
        //   const badgeObjectId = badgeIdMap.get(n.badge_id);
        //   if (badgeObjectId) notifData.badge = badgeObjectId;
        // }

        await Notification.create(notifData);
    }
    console.log("✅ Seeded Notifications");

    // ===== 9. UPDATE USERS: badges + attended_events =====
    for (const u of mainDB.Users) {
        const userObjectId = userIdMap.get(u.id);
        if (!userObjectId) continue;

        // Build badges array for this user
        const badgesArray = (u.badges ?? [])
            .map((b) => {
                const badgeObjectId = badgeIdMap.get(b.badge_id);
                if (!badgeObjectId) return null;

                const earnedDate = b.Earned_Date || b.earned_date;

                return {
                    badge: badgeObjectId,
                    // our subdocument schema has timestamps: true
                    // we can optionally set createdAt manually:
                    ...(earnedDate && {
                        createdAt: new Date(earnedDate),
                        updatedAt: new Date(earnedDate),
                    }),
                };
            })
            .filter(Boolean);

        // Build attended_events as ObjectIds
        const attendedEventsArray = (u.attended_events ?? [])
            .map((eid) => eventIdMap.get(eid))
            .filter(Boolean);

        await User.findByIdAndUpdate(
            userObjectId,
            {
                badges: badgesArray,
                attended_events: attendedEventsArray,
            },
            { new: false }
        );
    }
    console.log("✅ Updated Users with badges + attended_events");

    await mongoose.disconnect();
    console.log("🎉 Seeding complete");
}

main().catch((err) => {
    console.error("❌ Seed error:", err);
    process.exit(1);
});
