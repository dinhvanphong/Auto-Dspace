"use client";
import { useState } from "react";

/* ===== Helpers ===== */
function detectFormat(text = "") {
  const t = text.trim();
  if (t.startsWith("<")) return "xml";
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  return "text";
}

function formatXML(xml) {
  let formatted = "";
  const reg = /(>)(<)(\/*)/g;
  xml = xml.replace(reg, "$1\n$2$3");
  let pad = 0;
  xml.split("\n").forEach((node) => {
    let indent = 0;
    if (node.match(/.+<\/\w[^>]*>$/)) indent = 0;
    else if (node.match(/^<\/\w/)) pad--;
    else if (node.match(/^<\w([^>]*[^/])?>/)) indent = 1;
    formatted += " ".repeat(Math.max(pad, 0)) + node + "\n";
    pad += indent;
  });
  return formatted.trim();
}

// Hàm parse item ID từ XML response
function extractItemId(responseString) {
  try {
    // Thử parse JSON trước
    if (responseString.trim().startsWith("{") || responseString.trim().startsWith("[")) {
      const jsonData = JSON.parse(responseString);
      // Ưu tiên uuid
      if (jsonData.uuid) {
        return jsonData.uuid;
      }
      // Nếu không có uuid thì dùng id
      if (jsonData.id) {
        return jsonData.id;
      }
    }
    
    // Nếu là XML, parse XML
    // DSpace thường trả về XML có dạng: <item id="123">
    const idMatch = responseString.match(/id="(\d+)"/);
    if (idMatch && idMatch[1]) {
      return idMatch[1];
    }
    
    // Hoặc có thể trong attribute uuid
    const uuidMatch = responseString.match(/uuid="([^"]+)"/);
    if (uuidMatch && uuidMatch[1]) {
      return uuidMatch[1];
    }
    
    // Hoặc trong tag <id>
    const tagMatch = responseString.match(/<id>(\d+)<\/id>/);
    if (tagMatch && tagMatch[1]) {
      return tagMatch[1];
    }
    
    return null;
  } catch (err) {
    console.error("Error parsing item ID:", err);
    return null;
  }
}

export default function Page() {
  // ===== LOGIN =====
  const [email, setEmail] = useState("tuyendv@hpu.edu.vn");
  const [password, setPassword] = useState("123654");
  // ===== SESSION =====
  const [session, setSession] = useState(null);
  // ===== ITEM METADATA =====
  const [title, setTitle] = useState("Cơ sở văn hóa Việt Nam-Giáo dục-2001");
  const [author, setAuthor] = useState("Nguyễn Văn A");
  const [year, setYear] = useState("2024");
  const [abstract, setAbstract] = useState(
    "Cơ sở văn hóa Việt Nam-Giáo dục-2001_pdfa"
  );
  // ===== FILE UPLOAD =====
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState("");
  
  // ===== STATE =====
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // ===== CHECK SESSION (CỰC KỲ QUAN TRỌNG) =====
  const checkSession = async () => {
    const res = await fetch("/api/session", {
      credentials: "include",
    });
    const data = await res.json();
    console.log("SESSION:", data);
    setSession(data);
    return data;
  };

  // ===== LOGIN =====
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err);
        return;
      }
      // 👉 KHÔNG dùng response login
      await checkSession();
    } catch (err) {
      setError({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // ===== HANDLE FILE CHANGE =====
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      // Giới hạn kích thước file (50MB)
      if (selectedFile.size > 100 * 1024 * 1024) {
        setError({ error: "File size must be less than 50MB" });
        return;
      }
      setFile(selectedFile);
      setError(null);
    }
  };

  // ===== UPLOAD FILE TO BITSTREAM =====
  const uploadFileToBitstream = async (itemId) => {
    if (!file) return { success: true, message: "No file to upload" };

    setUploadProgress("Uploading file...");
    
    console.log("=== CLIENT UPLOAD DEBUG ===");
    console.log("File object:", file);
    console.log("Item ID:", itemId);
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("itemId", itemId);
    
    // Debug FormData
    console.log("FormData entries:");
    for (let [key, value] of formData.entries()) {
      console.log(key, value instanceof File ? `File: ${value.name}` : value);
    }

    const res = await fetch("/api/bitstreams", {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    const data = await res.json();
    
    console.log("Upload response:", data);
    
    if (!data.success) {
      throw new Error(data.error || "Failed to upload file");
    }
    
    return data;
  };

  // ===== CREATE ITEM + UPLOAD FILE =====
  const handleCreateItem = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setUploadProgress("");
    
    try {
      // BƯỚC 1: Tạo item
      setUploadProgress("Creating item...");
      
      const res = await fetch("/api/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          metadata: [
            { key: "dc.title", value: title },
            { key: "dc.contributor.author", value: author },
            { key: "dc.date.issued", value: year },
            { key: "dc.description.abstract", value: abstract },
            { key: "dc.language.iso", value: "vi" },
            { key: "dc.type", value: "Text" },
          ],
        }),
      });
      
      const itemData = await res.json();
      
      if (!itemData.success) {
        throw new Error(itemData.error || "Failed to create item");
      }

      //BƯỚC 2: Parse item ID từ response
      
      const itemId = extractItemId(itemData.raw);
      
      console.log("Extracted Item ID:", itemId);
      console.log("Raw response:", itemData.raw);
      
      if (!itemId) {
        setResult({
          ...itemData,
          warning: "⚠️ Item created but could not extract ID. Please check raw response and upload file manually.",
          itemId: "Unknown",
        });
        setUploadProgress("");
        return;
      }

      // BƯỚC 3: Nếu có file, upload lên item
      	// 261e1c26-08c2-4409-9621-30c0065c45b9
        // const itemId = "261e1c26-08c2-4409-9621-30c0065c45b9";
      let uploadResult = null;
      if (file) {
        uploadResult = await uploadFileToBitstream(itemId);
      }

      // BƯỚC 4: Hiển thị kết quả
      setResult({
        success: true,
        itemId: itemId,
        itemCreated: itemData.message,
        fileUploaded: uploadResult ? uploadResult.message : "No file uploaded",
        itemResponse: itemData.raw,
        fileResponse: uploadResult ? uploadResult.raw : null,
      });

      // Reset form
      setTitle("");
      setAuthor("");
      setYear("");
      setAbstract("");
      setFile(null);
      // Reset file input
      const fileInput = document.getElementById("fileInput");
      if (fileInput) fileInput.value = "";
      
    } catch (err) {
      setError({ error: err.message });
    } finally {
      setLoading(false);
      setUploadProgress("");
    }
  };

  /* ===== UI ===== */
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-10 text-center">
          DSpace 6.3 REST API Tester
        </h1>

        {!session?.authenticated && (
          <div className="bg-white shadow-lg rounded-xl p-7 border border-gray-200">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">Login</h2>
            <form onSubmit={handleLogin} className="space-y-5">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
              <button
                disabled={loading}
                className={`
                  w-full py-3 px-6 font-medium rounded-lg text-white transition-colors duration-200
                  ${loading 
                    ? "bg-blue-400 cursor-not-allowed" 
                    : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"}
                `}
              >
                {loading ? "Logging in..." : "Login"}
              </button>
            </form>
          </div>
        )}

        {session?.authenticated && (
          <>
            <div className="bg-green-50 border border-green-200 rounded-xl p-7 mt-10 shadow-sm">
              <h2 className="text-2xl font-semibold text-green-800 mb-5">
                ✅ Đăng nhập thành công
              </h2>
              <pre className="bg-green-900/10 p-5 rounded-lg text-sm overflow-x-auto font-mono text-green-950">
                {JSON.stringify(session, null, 2)}
              </pre>
            </div>

            <div className="bg-white shadow-lg rounded-xl p-7 mt-10 border border-gray-200">
              <h2 className="text-2xl font-semibold text-gray-800 mb-6">
                Insert Item + Upload File
              </h2>
              <form onSubmit={handleCreateItem} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    placeholder="Enter title"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Author <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    required
                    placeholder="Enter author name"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Year <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    required
                    placeholder="YYYY"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Abstract
                  </label>
                  <textarea
                    value={abstract}
                    onChange={(e) => setAbstract(e.target.value)}
                    placeholder="Enter abstract"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all min-h-[120px] resize-y"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Upload File (Optional)
                  </label>
                  <input
                    id="fileInput"
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.doc,.docx,.txt,.jpg,.png,.zip"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                  />
                  {file && (
                    <div className="mt-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <p className="text-sm text-indigo-800 font-medium">
                        📎 Selected: {file.name}
                      </p>
                      <p className="text-xs text-indigo-600 mt-1">
                        Size: {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  )}
                </div>

                {uploadProgress && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-3"></div>
                      <p className="text-sm text-blue-800 font-medium">{uploadProgress}</p>
                    </div>
                  </div>
                )}

                <button
                  disabled={loading}
                  className={`
                    w-full md:w-auto px-8 py-3 font-medium rounded-lg text-white transition-colors duration-200
                    ${loading 
                      ? "bg-indigo-400 cursor-not-allowed" 
                      : "bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800"}
                  `}
                >
                  {loading ? "Processing..." : file ? "Create Item & Upload File" : "Create Item"}
                </button>
              </form>
            </div>
          </>
        )}

        {result && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-7 mt-10 shadow-sm">
            <h3 className="text-xl font-semibold text-blue-800 mb-5">
              ✅ Result
            </h3>
            
            {result.itemId && (
              <div className="mb-4 p-4 bg-white rounded-lg border border-blue-200">
                <p className="text-sm font-semibold text-gray-700">Item ID:</p>
                <p className="text-lg font-mono text-blue-600">{result.itemId}</p>
              </div>
            )}

            {result.itemCreated && (
              <p className="text-green-700 mb-2">✓ {result.itemCreated}</p>
            )}
            
            {result.fileUploaded && (
              <p className="text-green-700 mb-2">✓ {result.fileUploaded}</p>
            )}
            
            {result.warning && (
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-300 rounded-lg">
                <p className="text-yellow-800">{result.warning}</p>
              </div>
            )}

            <details className="mt-5">
              <summary className="cursor-pointer text-sm text-blue-700 hover:text-blue-900 font-medium">
                📋 View Technical Details
              </summary>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">Item Response:</p>
                  <pre className="bg-blue-900/10 p-4 rounded-lg text-xs overflow-x-auto font-mono text-blue-950 whitespace-pre-wrap break-words">
                    {result.itemResponse
                      ? detectFormat(result.itemResponse) === "xml"
                        ? formatXML(result.itemResponse)
                        : JSON.stringify(JSON.parse(result.itemResponse), null, 2)
                      : "No response"}
                  </pre>
                </div>
                
                {result.fileResponse && (
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2">File Upload Response:</p>
                    <pre className="bg-blue-900/10 p-4 rounded-lg text-xs overflow-x-auto font-mono text-blue-950 whitespace-pre-wrap break-words">
                      {detectFormat(result.fileResponse) === "xml"
                        ? formatXML(result.fileResponse)
                        : JSON.stringify(JSON.parse(result.fileResponse), null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-7 mt-10 shadow-sm">
            <h3 className="text-xl font-semibold text-red-800 mb-5">❌ Error</h3>
            <pre className="bg-red-900/10 p-5 rounded-lg text-sm overflow-x-auto font-mono text-red-950 whitespace-pre-wrap break-words">
              {JSON.stringify(error, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}