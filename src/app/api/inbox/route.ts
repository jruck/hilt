import { NextRequest, NextResponse } from "next/server";
import {
  createInboxItem,
  getInboxItems,
  updateInboxItem,
  deleteInboxItem,
} from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function GET() {
  try {
    const items = await getInboxItems();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Error fetching inbox items:", error);
    return NextResponse.json(
      { error: "Failed to fetch inbox items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, projectPath, sortOrder } = body;

    if (!prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    const id = uuidv4();
    await createInboxItem(id, prompt, projectPath, sortOrder);

    return NextResponse.json({ id, success: true });
  } catch (error) {
    console.error("Error creating inbox item:", error);
    return NextResponse.json(
      { error: "Failed to create inbox item" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, prompt, sortOrder } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await updateInboxItem(id, prompt, sortOrder);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating inbox item:", error);
    return NextResponse.json(
      { error: "Failed to update inbox item" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await deleteInboxItem(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting inbox item:", error);
    return NextResponse.json(
      { error: "Failed to delete inbox item" },
      { status: 500 }
    );
  }
}
