/**
 * js/app.js
 * Konfigurasi Supabase, Utilitas Bootstrap Toast/Modal (Tanpa Alert Bawaan),
 * Upload Storage, & Loader Pengaturan Tema Dinamis (Logo & Background)
 */

const SUPABASE_URL = 'https://icrxhryhnjwzdjcbvuvf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljcnhocnlobmp3emRqY2J2dXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3OTc5MzEsImV4cCI6MjExMDM3MzkzMX0.tKjC6nlta6I4wvS84aqsOAPNOF1u8mH26CYSwhC0rHs';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const AppUI = {
    /**
     * Tampilkan Bootstrap 5 Toast elegan di pojok kanan atas
     * @param {string} message 
     * @param {'success'|'danger'|'warning'|'info'} type 
     */
    toast(message, type = 'success') {
        const container = document.getElementById('globalToastContainer');
        if (!container) return;

        const iconMap = {
            success: 'bi-check-circle-fill text-success',
            danger: 'bi-x-octagon-fill text-danger',
            warning: 'bi-exclamation-triangle-fill text-warning',
            info: 'bi-info-circle-fill text-primary'
        };

        const toastEl = document.createElement('div');
        toastEl.className = 'toast align-items-center bg-white border-0 rounded-4 shadow-lg mb-2';
        toastEl.setAttribute('role', 'alert');
        toastEl.setAttribute('aria-live', 'assertive');
        toastEl.setAttribute('aria-atomic', 'true');

        toastEl.innerHTML = `
            <div class="d-flex p-3 align-items-center">
                <i class="bi ${iconMap[type] || iconMap.info} fs-4 me-3"></i>
                <div class="toast-body p-0 fw-semibold text-dark small flex-grow-1">${message}</div>
                <button type="button" class="btn-close ms-2" data-bs-dismiss="toast"></button>
            </div>
        `;

        container.appendChild(toastEl);
        const bsToast = new bootstrap.Toast(toastEl, { delay: 3800 });
        bsToast.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    },

    /**
     * Dialog Konfirmasi berbasis Bootstrap Modal (Pengganti window.confirm)
     */
    confirm(title, message, onConfirm, confirmText = 'Ya, Lanjutkan', btnClass = 'btn-danger') {
        const modalEl = document.getElementById('globalDialogModal');
        document.getElementById('globalDialogTitle').textContent = title;
        document.getElementById('globalDialogBody').innerHTML = message;

        const footer = document.getElementById('globalDialogFooter');
        footer.innerHTML = `
            <button type="button" class="btn btn-light rounded-3 fw-semibold" data-bs-dismiss="modal">Batal</button>
            <button type="button" class="btn ${btnClass} rounded-3 fw-semibold px-4" id="btnGlobalConfirmYes">${confirmText}</button>
        `;

        const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
        bsModal.show();

        document.getElementById('btnGlobalConfirmYes').onclick = async () => {
            bsModal.hide();
            if (typeof onConfirm === 'function') await onConfirm();
        };
    },

    /**
     * Upload file gambar ke Supabase Storage bucket 'evoting-assets'
     */
    async uploadImageToStorage(file, folder = 'uploads') {
        const ext = file.name.split('.').pop();
        const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

        const { error: uploadError } = await db.storage
            .from('evoting-assets')
            .upload(fileName, file, { cacheControl: '3600', upsert: true });

        if (uploadError) throw uploadError;

        const { data } = db.storage.from('evoting-assets').getPublicUrl(fileName);
        return data.publicUrl;
    },

    /**
     * Terapkan kustomisasi Logo Sekolah, Judul, dan Background dari tabel settings
     */
    async loadAndApplySettings() {
        try {
            const { data, error } = await db
                .from('settings')
                .select('*')
                .eq('id', 1)
                .single();

            if (error || !data) return null;

            // Update semua elemen nama sekolah
            document.querySelectorAll('.dynamic-school-name').forEach(el => {
                el.textContent = data.school_name;
            });

            // Update semua elemen judul pemilihan
            document.querySelectorAll('.dynamic-election-title').forEach(el => {
                el.textContent = data.election_title;
            });

            // Update semua elemen logo sekolah
            if (data.logo_url) {
                document.querySelectorAll('.dynamic-school-logo').forEach(img => {
                    img.src = data.logo_url;
                });
            }

            // Update gambar latar belakang (Background) web jika diatur oleh Admin
            if (data.bg_url && data.bg_url.trim() !== '') {
                document.documentElement.style.setProperty('--custom-bg-image', `url('${data.bg_url.trim()}')`);
                document.body.classList.add('has-custom-bg');
            } else {
                document.documentElement.style.setProperty('--custom-bg-image', 'none');
                document.body.classList.remove('has-custom-bg');
            }

            return data;
        } catch (err) {
            console.error('Gagal memuat pengaturan UI:', err);
            return null;
        }
    },

    escapeHtml(str = '') {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AppUI.loadAndApplySettings();
});