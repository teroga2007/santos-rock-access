
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SUPABASE_URL = "https://fglmoixfvfgygoxhikmg.supabase.co";

const rl = createInterface({ input, output });

try {
  const secretKey = await rl.question("Supabase secret/service_role key: ");
  const userId = await rl.question("UUID de tu usuario owner: ");
  const password = await rl.question("Nueva contraseña (mínimo 12 caracteres): ");

  if (password.length < 12) {
    throw new Error("La contraseña debe tener al menos 12 caracteres.");
  }

  const supabase = createClient(SUPABASE_URL, secretKey.trim(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.admin.updateUserById(
    userId.trim(),
    { password }
  );

  if (error) throw error;

  console.log("Contraseña actualizada para:", data.user.email);
} catch (error) {
  console.error("Error:", error.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
