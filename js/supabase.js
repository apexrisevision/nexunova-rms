const SUPABASE_URL = 'https://itqxljtfbrppntgyfush.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0eGxqdGZicnBwbmd5ZnVzaCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzc4MjU0NzQ5LCJleHAiOjIwOTM4MzA3NDl9.v2YX7yZ6JNi4sgPLJad8zbxVAZ7BmCY00uZYsbM6bV8';

const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
