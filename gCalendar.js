import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

// Checks Google Calendar for free/busy times and returns free intervals between timeMin and timeMax
export async function checkCalendarAvailability(
  timeMin,
  timeMax,
  google_service_account_key,
  google_calendar_email
) {
  try {
    // Initialize Google Calendar API with service account credentials
    const credentials = google_service_account_key;
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });

    const calendar = google.calendar({ version: "v3", auth });

    const calendarId = google_calendar_email;

    // Get busy times from calendar
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin || new Date().toISOString(),
        timeMax:
          timeMax || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
        items: [{ id: calendarId }],
      },
    });

    const busyTimes = response.data.calendars[calendarId].busy || [];

    // Find free time slots (simplified logic)
    const freeSlots = [];
    let currentTime = new Date(timeMin || new Date());
    const endTime = new Date(
      timeMax || new Date(Date.now() + 24 * 60 * 60 * 1000)
    );

    for (const busy of busyTimes) {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);

      // If there's a gap before this busy period, it's free
      if (currentTime < busyStart) {
        freeSlots.push({
          start: currentTime.toISOString(),
          end: busyStart.toISOString(),
        });
      }

      currentTime = busyEnd;
    }

    // Add remaining time after last busy period
    if (currentTime < endTime) {
      freeSlots.push({
        start: currentTime.toISOString(),
        end: endTime.toISOString(),
      });
    }

    return {
      busy: busyTimes,
      free: freeSlots,
    };
  } catch (error) {
    console.error("Error checking calendar availability:", error);
    return { error: error.message };
  }
}

// Filters slots to only include those that are on weekdays (Mon-Fri) and within 9:00-17:00
function restrictToWorkingHours(slots, work_start_hour, work_end_hour) {
  // Parse working hours as integers (interpreted as UTC hours)
  const WORK_START_HOUR = parseInt(work_start_hour, 10); // e.g., 9 for 9:00 UTC
  const WORK_END_HOUR = parseInt(work_end_hour, 10); // e.g., 17 for 17:00 UTC

  return slots
    .map(({ start, end }) => {
      const startDate = new Date(start);
      const endDate = new Date(end);
      // Only include if both start and end are on a weekday (Mon-Fri)
      // 0 = Sunday, 6 = Saturday
      const isWeekday = (date) => date.getDay() >= 1 && date.getDay() <= 5;
      if (!isWeekday(startDate) || !isWeekday(endDate)) {
        return null;
      }
      // Adjust start time if before working hours
      if (startDate.getUTCHours() < WORK_START_HOUR) {
        startDate.setUTCHours(WORK_START_HOUR, 0, 0, 0);
      }
      // Adjust end time if after working hours
      if (
        endDate.getUTCHours() > WORK_END_HOUR ||
        (endDate.getUTCHours() === WORK_END_HOUR && endDate.getUTCMinutes() > 0)
      ) {
        endDate.setUTCHours(WORK_END_HOUR, 0, 0, 0);
      }
      // Only include if the slot is still valid after adjustment
      if (startDate < endDate) {
        return { start: startDate, end: endDate };
      }
      return null;
    })
    .filter(Boolean);
}

// Splits each free interval into 1-hour slots, each starting at the top of the hour
function generateHourlySlots(slots, work_start_hour, work_end_hour) {
  // Parse working hours as integers (interpreted as UTC hours)
  const WORK_START_HOUR = parseInt(work_start_hour, 10); // e.g., 9 for 9:00 UTC
  const WORK_END_HOUR = parseInt(work_end_hour, 10); // e.g., 17 for 17:00 UTC

  const hourlySlots = [];
  const WORK_TZ = "Europe/Riga";
  slots.forEach(({ start, end }) => {
    let current = new Date(start);
    // Round up to next full hour if not already at the hour
    if (
      current.getMinutes() !== 0 ||
      current.getSeconds() !== 0 ||
      current.getMilliseconds() !== 0
    ) {
      current.setHours(current.getHours() + 1, 0, 0, 0);
    }
    const endDate = new Date(end);
    // Only include slots that fit fully within the interval
    while (current.getTime() + 60 * 60 * 1000 <= endDate.getTime()) {
      const slotStart = new Date(current);
      const slotEnd = new Date(current.getTime() + 60 * 60 * 1000);
      // Only include if slotStart is within working hours (Europe/Riga)
      const rigaHour = Number(
        slotStart.toLocaleString("en-US", {
          hour: "2-digit",
          hour12: false,
          timeZone: WORK_TZ,
        })
      );
      if (rigaHour >= WORK_START_HOUR && rigaHour < WORK_END_HOUR) {
        hourlySlots.push({ start: slotStart, end: slotEnd });
      }
      current.setHours(current.getHours() + 1);
    }
  });
  return hourlySlots;
}

// Groups consecutive hourly slots into intervals
function groupSlotsIntoIntervals(slots) {
  if (slots.length === 0) return [];

  const intervals = [];
  let currentInterval = {
    start: new Date(slots[0].start),
    end: new Date(slots[0].end),
  };

  for (let i = 1; i < slots.length; i++) {
    const currentSlot = slots[i];
    const previousEnd = new Date(currentInterval.end);

    // Check if this slot is consecutive (starts exactly when the previous ends)
    if (currentSlot.start.getTime() === previousEnd.getTime()) {
      // Extend the current interval
      currentInterval.end = new Date(currentSlot.end);
    } else {
      // End the current interval and start a new one
      intervals.push(currentInterval);
      currentInterval = {
        start: new Date(currentSlot.start),
        end: new Date(currentSlot.end),
      };
    }
  }

  // Add the last interval
  intervals.push(currentInterval);

  return intervals;
}

// Returns an object with available time intervals grouped by date for the next N days, weekdays only, in UTC+0 or requested UTC offset
export async function formattedCalendarAvailability(
  utc,
  days,
  google_service_account_key,
  google_calendar_email,
  work_start_hour,
  work_end_hour
) {
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const result = await checkCalendarAvailability(
    now.toISOString(),
    sevenDaysLater.toISOString(),
    google_service_account_key,
    google_calendar_email
  );

  // Restrict slots to working hours (weekdays only)
  const slots = restrictToWorkingHours(
    result.free,
    work_start_hour,
    work_end_hour
  );
  if (!Array.isArray(slots) || slots.length === 0) {
    return [];
  }

  // Split into 1-hour slots and group into intervals
  const hourlySlots = generateHourlySlots(
    slots,
    work_start_hour,
    work_end_hour
  );
  if (hourlySlots.length === 0) {
    return [];
  }

  // Group consecutive slots into intervals
  const intervals = groupSlotsIntoIntervals(hourlySlots);
  if (intervals.length === 0) {
    return [];
  }

  // Parse UTC offset (e.g., '+2', '-5', '2', '-5.5')
  let utcOffset = 0;
  if (typeof utc === "string" && utc.trim() !== "") {
    utcOffset = parseFloat(utc);
  } else if (typeof utc === "number") {
    utcOffset = utc;
  }

  // Format each interval as a JSON object with requested UTC offset
  const intervalObjects = intervals.map(({ start, end }) => {
    // Shift the start and end times by the UTC offset (in hours)
    const shiftedStart = new Date(start.getTime() + utcOffset * 60 * 60 * 1000);
    const shiftedEnd = new Date(end.getTime() + utcOffset * 60 * 60 * 1000);

    const day = shiftedStart
      .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
      .toLowerCase();
    const month = shiftedStart.toLocaleDateString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    const date = shiftedStart.getUTCDate();
    const year = shiftedStart.getUTCFullYear();
    const monthNum = (shiftedStart.getUTCMonth() + 1)
      .toString()
      .padStart(2, "0");
    const dateStr = `${year}-${monthNum}-${date.toString().padStart(2, "0")}`;

    // Format start time (24-hour format)
    const startHour = shiftedStart.getUTCHours().toString().padStart(2, "0");
    const startMinute = shiftedStart
      .getUTCMinutes()
      .toString()
      .padStart(2, "0");

    // Format end time (24-hour format)
    const endHour = shiftedEnd.getUTCHours().toString().padStart(2, "0");
    const endMinute = shiftedEnd.getUTCMinutes().toString().padStart(2, "0");

    // Format UTC offset for display (e.g., UTC+2, UTC-5)
    let offsetStr = "UTC";
    if (utcOffset > 0) {
      offsetStr = `UTC+${utcOffset}`;
    } else if (utcOffset < 0) {
      offsetStr = `UTC${utcOffset}`;
    }

    const interval = `${startHour}:${startMinute}-${endHour}:${endMinute} ${offsetStr}`;

    return { day, month, date, dateStr, interval };
  });

  // Group intervals by dateStr
  const grouped = {};
  for (const intervalObj of intervalObjects) {
    if (!grouped[intervalObj.dateStr]) {
      grouped[intervalObj.dateStr] = {
        day: intervalObj.day,
        month: intervalObj.month,
        date: intervalObj.date,
        intervals: [],
      };
    }
    grouped[intervalObj.dateStr].intervals.push(intervalObj.interval);
  }

  return grouped;
}

/**
 * Schedules a meeting in Google Calendar.
 * @param {Object} options
 * @param {string} options.start - ISO string for start time (e.g. "2025-07-18T09:00:00Z")
 * @param {string} options.end - ISO string for end time (e.g. "2025-07-18T10:00:00Z")
 * @param {string} options.summary - Event title
 * @param {string} [options.description] - Event description
 * @param {Array<{email: string}>} [options.attendees] - List of attendee emails
 * @returns {Promise<Object>} - Created event or error
 */
export async function scheduleMeeting({
  start,
  end,
  summary,
  description = "",
  attendees = [],
  google_service_account_key,
}) {
  const google_calendar_email = process.env.GOOGLE_CALENDAR_EMAIL;
  console.log("google_calendar_email: ", google_calendar_email);

  try {
    const credentials = google_service_account_key;
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
      clientOptions: {
        subject: google_calendar_email, // Impersonate this user
      },
    });
    const calendar = google.calendar({ version: "v3", auth });
    const calendarId = google_calendar_email;

    const event = {
      summary,
      description,
      start: { dateTime: start, timeZone: "UTC" },
      end: { dateTime: end, timeZone: "UTC" },
      attendees,
    };

    const response = await calendar.events.insert({
      calendarId,
      requestBody: event,
    });

    return response.data;
  } catch (error) {
    console.error("Error scheduling meeting:", error);
    return { error: error.message };
  }
}

// Helper: reduce calendar availability to only day, date, and intervals (no UTC)
export function minimalCalendarAvailability(raw) {
  return Object.values(raw).map((dayObj) => ({
    day: dayObj.day.charAt(0).toUpperCase() + dayObj.day.slice(1),
    date: dayObj.date,
    intervals: (dayObj.intervals || []).map(
      (interval) => interval.split(" ")[0]
    ),
  }));
}