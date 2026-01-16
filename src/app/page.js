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

function extractItemId(responseString) {
  try {
    if (responseString.trim().startsWith("{") || responseString.trim().startsWith("[")) {
      const jsonData = JSON.parse(responseString);
      if (jsonData.uuid) return jsonData.uuid;
      if (jsonData.id) return jsonData.id;
    }
    const idMatch = responseString.match(/id="(\d+)"/);
    if (idMatch && idMatch[1]) return idMatch[1];
    const uuidMatch = responseString.match(/uuid="([^"]+)"/);
    if (uuidMatch && uuidMatch[1]) return uuidMatch[1];
    const tagMatch = responseString.match(/<id>(\d+)<\/id>/);
    if (tagMatch && tagMatch[1]) return tagMatch[1];
    return null;
  } catch (err) {
    console.error("Error parsing item ID:", err);
    return null;
  }
}

// Parse single-row DSpace CSV (1 header + 1 data row per file)
function parseSingleRowDSpaceCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  
  if (lines.length < 5) {
    throw new Error("CSV file is too short. Expected at least 5 lines (4 headers + 1 data)");
  }
  
  // Parse headers (same as before)
  const schemaLine = lines[0].split(',');
  const elementLine = lines[1].split(',');
  const qualifierLine = lines[2].split(',');
  const languageLine = lines[3].split(',');
  
  // Build column mapping
  const columns = [];
  for (let i = 0; i < schemaLine.length; i++) {
    const schema = schemaLine[i].trim();
    const element = elementLine[i].trim();
    const qualifier = qualifierLine[i].trim();
    const language = languageLine[i].trim();
    
    if (schema && element) {
      let key = schema.toLowerCase() + '.' + element.toLowerCase();
      if (qualifier && qualifier !== 'none') {
        key += '.' + qualifier.toLowerCase();
      }
      
      columns.push({
        index: i,
        key: key,
        element: element,
        qualifier: qualifier,
        language: language || 'en_US'
      });
    }
  }
  
  // Parse ONLY first data row (line 5)
  const values = parseCSVLine(lines[4]);
  const metadata = [];
  
  for (const col of columns) {
    const value = values[col.index];
    if (value && value.trim()) {
      // Skip last column (usually filename or empty)
      if (col.index < values.length - 1 || !value.includes('.pdf')) {
        metadata.push({
          key: col.key,
          value: value.trim(),
          language: col.language
        });
      }
    }
  }
  
  return metadata;
}

// Parse CSV line with proper quote handling
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

export default function BulkUploadPage() {
  const [email, setEmail] = useState("tuyendv@hpu.edu.vn");
  const [password, setPassword] = useState("123654");
  const [session, setSession] = useState(null);
  
  // Bulk upload states
  const [uploadMode, setUploadMode] = useState("paired"); // "paired" mode mới
  const [isPrivate, setIsPrivate] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]); // Tất cả files (CSV + PDF)
  const [pairedItems, setPairedItems] = useState([]); // Items đã ghép cặp
  const [defaultAuthor, setDefaultAuthor] = useState("Nguyễn Văn A");
  const [defaultYear, setDefaultYear] = useState("2024");
  
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const checkSession = async () => {
    const res = await fetch("/api/session", { credentials: "include" });
    const data = await res.json();
    setSession(data);
    return data;
  };

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
      await checkSession();
    } catch (err) {
      setError({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Handle multiple files selection and auto-pairing
  const handleMultipleFilesChange = async (e) => {
    const files = Array.from(e.target.files);
    setSelectedFiles(files);
    setError(null);
    
    try {
      // Separate CSV and PDF files
      const csvFiles = files.filter(f => f.name.endsWith('.csv'));
      const pdfFiles = files.filter(f => f.name.endsWith('.pdf'));
      
      console.log(`Found ${csvFiles.length} CSV files and ${pdfFiles.length} PDF files`);
      
      // Parse and pair files
      const pairs = [];
      
      for (const csvFile of csvFiles) {
        const csvBasename = csvFile.name.replace('.csv', '');
        
        // Find matching PDF
        const pdfFile = pdfFiles.find(f => {
          const pdfBasename = f.name.replace('.pdf', '');
          return pdfBasename === csvBasename;
        });
        
        // Parse CSV
        const csvText = await csvFile.text();
        const metadata = parseSingleRowDSpaceCSV(csvText);
        
        // Get title for display
        const titleMeta = metadata.find(m => m.key.includes('title'));
        const title = titleMeta ? titleMeta.value : csvBasename;
        
        pairs.push({
          basename: csvBasename,
          csvFile: csvFile,
          pdfFile: pdfFile,
          metadata: metadata,
          title: title,
          hasPdf: !!pdfFile
        });
      }
      
      setPairedItems(pairs);
      console.log('Paired items:', pairs);
      
    } catch (err) {
      setError({ error: "Failed to process files: " + err.message });
      setPairedItems([]);
    }
  };

  // Create single item
  const createItem = async (metadata) => {
    console.log("=== CREATING ITEM ===");
    console.log("Metadata:", JSON.stringify(metadata, null, 2));
    
    const res = await fetch("/api/item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ metadata }),
    });
    
    const data = await res.json();
    console.log("Create item response:", data);
    
    return data;
  };

  // Upload file to item
  const uploadFile = async (itemId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("itemId", itemId);

    const res = await fetch("/api/bitstream", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    return await res.json();
  };

  // Get item policies
  const getItemPolicies = async (itemId) => {
    const res = await fetch(`/api/item-policies?itemId=${itemId}`, {
      credentials: "include",
    });
    return await res.json();
  };

  // Get bitstream policies
  const getBitstreamPolicies = async (bitstreamId) => {
    const res = await fetch(`/api/bitstream-policies?bitstreamId=${bitstreamId}`, {
      credentials: "include",
    });
    return await res.json();
  };

  // Delete anonymous READ policies
  const deleteAnonymousRead = async (policiesResponse) => {
    if (!policiesResponse.success || !policiesResponse.data) {
      return { deleted: 0 };
    }

    const policies = Array.isArray(policiesResponse.data) 
      ? policiesResponse.data 
      : [policiesResponse.data];

    let deleted = 0;
    
    for (const policy of policies) {
      // Tìm policy có groupId = 0 (Anonymous) và action = READ
      if (policy.groupId === 0 && policy.action === "READ") {
        const res = await fetch(`/api/delete-policy?policyId=${policy.id}`, {
          method: "DELETE",
          credentials: "include",
        });
        
        if ((await res.json()).success) {
          deleted++;
        }
      }
    }

    return { deleted };
  };

  // Create private item (with policies removal)
  const createPrivateItem = async (metadata, file) => {
    // 1. Create item
    const itemResult = await createItem(metadata);
    if (!itemResult.success) {
      throw new Error(itemResult.error || "Failed to create item");
    }

    const itemId = extractItemId(itemResult.raw);
    if (!itemId) {
      throw new Error("Could not extract item ID");
    }

    // 2. Upload file
    let bitstreamId = null;
    if (file) {
      const uploadResult = await uploadFile(itemId, file);
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || "Failed to upload file");
      }
      
      // Extract bitstream ID from response
      const bitstreamData = uploadResult.raw ? JSON.parse(uploadResult.raw) : null;
      bitstreamId = bitstreamData?.uuid || bitstreamData?.id;
    }

    // 3. Remove anonymous READ from item
    const itemPolicies = await getItemPolicies(itemId);
    const itemDeleted = await deleteAnonymousRead(itemPolicies);

    // 4. Remove anonymous READ from bitstream (if exists)
    let bitstreamDeleted = { deleted: 0 };
    if (bitstreamId) {
      const bitPolicies = await getBitstreamPolicies(bitstreamId);
      bitstreamDeleted = await deleteAnonymousRead(bitPolicies);
    }

    return {
      itemId,
      bitstreamId,
      policiesRemoved: {
        item: itemDeleted.deleted,
        bitstream: bitstreamDeleted.deleted,
      }
    };
  };

  // BULK UPLOAD: Paired CSV + PDF mode
  const handleBulkUploadPaired = async () => {
    if (pairedItems.length === 0) {
      setError({ error: "Please select CSV and PDF files first" });
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setProgress([]);

    try {
      for (let i = 0; i < pairedItems.length; i++) {
        const item = pairedItems[i];
        
        setProgress(prev => [...prev, 
          `[${i + 1}/${pairedItems.length}] Creating item: ${item.title.substring(0, 60)}...`
        ]);

        try {
          if (isPrivate) {
            // CREATE PRIVATE ITEM
            const result = await createPrivateItem(item.metadata, item.pdfFile);
            
            setResults(prev => [...prev, {
              title: item.title,
              basename: item.basename,
              itemId: result.itemId,
              bitstreamId: result.bitstreamId,
              hasPdf: item.hasPdf,
              status: "success",
              private: true,
              policiesRemoved: result.policiesRemoved,
            }]);
          } else {
            // CREATE PUBLIC ITEM
            const itemResult = await createItem(item.metadata);
            
            if (!itemResult.success) {
              throw new Error(itemResult.error || "Failed to create item");
            }

            const itemId = extractItemId(itemResult.raw);
            if (!itemId) {
              throw new Error("Could not extract item ID");
            }

            // Upload PDF if exists
            let uploadResult = null;
            if (item.pdfFile) {
              setProgress(prev => [...prev, 
                `[${i + 1}/${pairedItems.length}] Uploading file: ${item.pdfFile.name}`
              ]);
              uploadResult = await uploadFile(itemId, item.pdfFile);
            }

            setResults(prev => [...prev, {
              title: item.title,
              basename: item.basename,
              itemId: itemId,
              hasPdf: item.hasPdf,
              fileUploaded: uploadResult?.success || false,
              status: "success",
              private: false,
            }]);
          }
        } catch (err) {
          setResults(prev => [...prev, {
            title: item.title,
            basename: item.basename,
            status: "failed",
            error: err.message
          }]);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err) {
      setError({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-10 text-center">
          DSpace Bulk Upload Tool
        </h1>

        {!session?.authenticated && (
          <div className="bg-white shadow-lg rounded-xl p-7 border border-gray-200">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">Login</h2>
            <form onSubmit={handleLogin} className="space-y-5">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button
                disabled={loading}
                className={`w-full py-3 px-6 font-medium rounded-lg text-white transition-colors duration-200 ${
                  loading ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {loading ? "Logging in..." : "Login"}
              </button>
            </form>
          </div>
        )}

        {session?.authenticated && (
          <>
            <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-8">
              <p className="text-green-800 font-semibold">✅ Đã đăng nhập</p>
            </div>

            {/* Mode Selection */}
            <div className="bg-white shadow-lg rounded-xl p-7 border border-gray-200 mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 mb-4">
                📦 Bulk Upload - CSV + PDF Pairing
              </h2>
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
                <p className="text-sm text-blue-800 font-medium">📋 Cách sử dụng:</p>
                <ul className="text-xs text-blue-700 mt-2 space-y-1">
                  <li>1. Chọn tất cả files CSV + PDF cùng lúc</li>
                  <li>2. Hệ thống tự động ghép cặp theo tên file (VD: HPU2166889.csv ↔ HPU2166889.pdf)</li>
                  <li>3. Mỗi CSV chứa metadata cho 1 item (4 dòng header + 1 dòng data)</li>
                  <li>4. Bật Private mode nếu muốn tạo items riêng tư</li>
                </ul>
              </div>
            </div>

            {/* Upload Section */}
            <div className="bg-white shadow-lg rounded-xl p-7 border border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">
                Upload CSV + PDF Files
              </h3>

              <div className="space-y-4">
                {/* Private mode toggle */}
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                      className="w-5 h-5 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                    />
                    <div className="ml-3">
                      <span className="text-sm font-medium text-gray-900">
                        🔒 Create Private Items
                      </span>
                      <p className="text-xs text-gray-600 mt-1">
                        Tự động xóa quyền READ của Anonymous (chỉ admin/owner xem được)
                      </p>
                    </div>
                  </label>
                </div>

                {/* File input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select All Files (CSV + PDF)
                  </label>
                  <input
                    type="file"
                    multiple
                    accept=".csv,.pdf"
                    onChange={handleMultipleFilesChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                  />
                  {selectedFiles.length > 0 && (
                    <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                      <p className="text-sm text-gray-700 font-medium">
                        📂 Selected {selectedFiles.length} file(s)
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        CSV: {selectedFiles.filter(f => f.name.endsWith('.csv')).length} | 
                        PDF: {selectedFiles.filter(f => f.name.endsWith('.pdf')).length}
                      </p>
                    </div>
                  )}
                </div>

                {/* Paired items preview */}
                {pairedItems.length > 0 && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800 font-medium mb-3">
                      ✅ Found {pairedItems.length} paired item(s)
                    </p>
                    <div className="space-y-2 max-h-96 overflow-auto">
                      {pairedItems.map((item, i) => (
                        <div key={i} className="p-3 bg-white rounded-lg border border-green-200">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-gray-800">
                                {i + 1}. {item.title.substring(0, 80)}
                                {item.title.length > 80 && '...'}
                              </p>
                              <div className="flex gap-3 mt-2 text-xs">
                                <span className="text-gray-600">
                                  📄 CSV: {item.csvFile.name}
                                </span>
                                {item.hasPdf ? (
                                  <span className="text-green-600 font-medium">
                                    ✅ PDF: {item.pdfFile.name}
                                  </span>
                                ) : (
                                  <span className="text-red-600 font-medium">
                                    ❌ No matching PDF
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                Metadata fields: {item.metadata.length}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Upload button */}
                <button
                  onClick={handleBulkUploadPaired}
                  disabled={loading || pairedItems.length === 0}
                  className={`w-full py-3 px-6 font-medium rounded-lg text-white transition-colors ${
                    loading || pairedItems.length === 0
                      ? "bg-gray-400 cursor-not-allowed"
                      : isPrivate
                      ? "bg-purple-600 hover:bg-purple-700"
                      : "bg-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  {loading 
                    ? "Processing..." 
                    : isPrivate
                    ? `🔒 Create ${pairedItems.length} Private Items`
                    : `🚀 Create ${pairedItems.length} Items`
                  }
                </button>
              </div>
            </div>

            {/* Progress */}
            {progress.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mt-8">
                <h3 className="text-lg font-semibold text-blue-800 mb-3">Progress</h3>
                <div className="space-y-1 max-h-60 overflow-auto">
                  {progress.map((msg, i) => (
                    <p key={i} className="text-sm text-blue-700">{msg}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Results */}
            {results.length > 0 && (
              <div className="bg-white shadow-lg rounded-xl p-7 border border-gray-200 mt-8">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">Results</h3>
                <div className="space-y-2 max-h-96 overflow-auto">
                  {results.map((result, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-lg border ${
                        result.status === "success"
                          ? result.private
                            ? "bg-purple-50 border-purple-200"
                            : "bg-green-50 border-green-200"
                          : "bg-red-50 border-red-200"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {result.status === "success" ? (result.private ? "🔒" : "✅") : "❌"}{" "}
                            {result.title || result.basename}
                          </p>
                          {result.basename && (
                            <p className="text-xs text-gray-500 mt-1">
                              File: {result.basename}
                            </p>
                          )}
                          {result.itemId && (
                            <p className="text-xs text-gray-600 mt-1">
                              Item ID: {result.itemId}
                            </p>
                          )}
                          {result.bitstreamId && (
                            <p className="text-xs text-gray-600 mt-1">
                              Bitstream ID: {result.bitstreamId}
                            </p>
                          )}
                          {result.hasPdf !== undefined && (
                            <p className="text-xs mt-1">
                              {result.hasPdf ? (
                                <span className="text-green-600">📎 PDF uploaded</span>
                              ) : (
                                <span className="text-yellow-600">⚠️ No PDF file</span>
                              )}
                            </p>
                          )}
                          {result.private && result.policiesRemoved && (
                            <p className="text-xs text-purple-600 mt-1">
                              🔒 Policies removed: Item ({result.policiesRemoved.item}), Bitstream ({result.policiesRemoved.bitstream})
                            </p>
                          )}
                          {result.error && (
                            <p className="text-xs text-red-600 mt-1">
                              Error: {result.error}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-sm text-gray-700">
                    <span className="font-semibold">Total:</span> {results.length} items |{" "}
                    <span className="text-green-600 font-semibold">
                      {results.filter(r => r.status === "success").length} succeeded
                    </span>{" "}
                    |{" "}
                    <span className="text-red-600 font-semibold">
                      {results.filter(r => r.status === "failed").length} failed
                    </span>
                    {results.some(r => r.private) && (
                      <>
                        {" "}|{" "}
                        <span className="text-purple-600 font-semibold">
                          {results.filter(r => r.private).length} private
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 mt-8">
                <h3 className="text-lg font-semibold text-red-800 mb-2">Error</h3>
                <pre className="text-sm text-red-700 whitespace-pre-wrap">
                  {JSON.stringify(error, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}