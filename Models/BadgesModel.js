// models/Badge.js
/* 
This is the bagdes collection that allows the user to claim badges whenever he meets the prerequisite. I have included the badgeId
so that in the application it is easier for the backend to recognise which badge to give the user rather than using regex or using the badges
the object ID to find. I have made the user reference the badges object ID instead of the business badgeID, because MongoDB is faster and more efficient
in using their own ID. So our ID is for the logic to be more specific, and the mongoDB badge is more for fast and efficient enrichment of response back to the
frontend.
*/
import mongoose from "mongoose";

const badgeSchema = new mongoose.Schema(
    {
        badgeId: {          
            type: String,
            required: true,
            unique: true,
            trim: true,            
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },

        description: {
            type: String,
            required: true,
            trim: true,
        },

        // e.g. "/badges/BadgeBABY.png"
        icon_image: {
            type: String,
            required: true,
            trim: true,
        },
    },
);

const Badge = mongoose.model("Badge", badgeSchema);

export default Badge;
