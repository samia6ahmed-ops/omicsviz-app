import { supabase } from "./supabaseClient";

// Cloud project storage (Supabase table `projects`, protected by row-level
// security so each signed-in user only ever sees their own rows).
const MAX_BYTES = 8 * 1024 * 1024;

export async function listProjects(tool) {
  const { data, error } = await supabase
    .from("projects")
    .select("id,name,updated_at")
    .eq("tool", tool)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getProject(id) {
  const { data, error } = await supabase.from("projects").select("id,name,data").eq("id", id).single();
  if (error) throw error;
  return data;
}

function checkSize(payload) {
  const bytes = JSON.stringify(payload).length;
  if (bytes > MAX_BYTES) {
    throw new Error(
      "This project is " + (bytes / 1048576).toFixed(1) + " MB, too large for cloud save. Use “Save Project” to download it instead."
    );
  }
}

export async function createProject(tool, name, payload) {
  checkSize(payload);
  const { data, error } = await supabase
    .from("projects").insert({ tool, name, data: payload }).select("id,name,updated_at").single();
  if (error) throw error;
  return data;
}

export async function updateProject(id, name, payload) {
  checkSize(payload);
  const { data, error } = await supabase
    .from("projects").update({ name, data: payload, updated_at: new Date().toISOString() })
    .eq("id", id).select("id,name,updated_at").single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}
