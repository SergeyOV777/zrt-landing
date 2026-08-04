// ==========================================================================
// ZRT School - Improved JavaScript
// ==========================================================================

// Global variables
let currentSlideIndex = 0;
let lightboxImages = [];
let currentLightboxIndex = 0;

// ==========================================================================
// Utility Functions
// ==========================================================================

function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function scrollToForm() {
    scrollToSection('form');
}

// ==========================================================================
// Header Scroll Effect
// ==========================================================================

function initHeaderScroll() {
    const header = document.querySelector('.header');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });
}

// ==========================================================================
// Animated Stats Counter
// ==========================================================================

function animateStats() {
    const stats = document.querySelectorAll('.stat-number');
    const observerOptions = {
        threshold: 0.5,
        rootMargin: '0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const target = parseInt(entry.target.getAttribute('data-target'));
                animateCounter(entry.target, 0, target, 2000);
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    stats.forEach(stat => observer.observe(stat));
}

function animateCounter(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16); // 60fps
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if (current >= end) {
            element.textContent = formatNumber(end);
            clearInterval(timer);
        } else {
            element.textContent = formatNumber(Math.floor(current));
        }
    }, 16);
}

function formatNumber(num) {
    if (num >= 1000) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
    return num.toString();
}

// ==========================================================================
// Carousel Functionality
// ==========================================================================

function initCarousel() {
    const slides = document.querySelectorAll('.moto-slide');
    const dots = document.querySelectorAll('.dot');
    
    if (slides.length === 0) return;

    // Auto-advance carousel
    setInterval(() => {
        moveCarousel(1);
    }, 7000);

    // Touch/swipe support
    let touchStartX = 0;
    let touchEndX = 0;
    const carouselContainer = document.querySelector('.moto-carousel-container');

    if (carouselContainer) {
        carouselContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        });

        carouselContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        });
    }

    function handleSwipe() {
        if (touchEndX < touchStartX - 50) {
            moveCarousel(1);
        }
        if (touchEndX > touchStartX + 50) {
            moveCarousel(-1);
        }
    }
}

function moveCarousel(direction) {
    const slides = document.querySelectorAll('.moto-slide');
    const dots = document.querySelectorAll('.dot');
    
    if (slides.length === 0) return;
    
    slides[currentSlideIndex].classList.remove('active');
    dots[currentSlideIndex].classList.remove('active');
    
    currentSlideIndex += direction;
    
    if (currentSlideIndex >= slides.length) {
        currentSlideIndex = 0;
    } else if (currentSlideIndex < 0) {
        currentSlideIndex = slides.length - 1;
    }
    
    slides[currentSlideIndex].classList.add('active');
    dots[currentSlideIndex].classList.add('active');
}

function currentSlide(index) {
    const slides = document.querySelectorAll('.moto-slide');
    const dots = document.querySelectorAll('.dot');
    
    if (slides.length === 0) return;
    
    slides[currentSlideIndex].classList.remove('active');
    dots[currentSlideIndex].classList.remove('active');
    
    currentSlideIndex = index;
    
    slides[currentSlideIndex].classList.add('active');
    dots[currentSlideIndex].classList.add('active');
}

// ==========================================================================
// Lightbox Gallery
// ==========================================================================

function initGallery() {
    const galleryItems = document.querySelectorAll('.gallery-item');
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    
    lightboxImages = Array.from(galleryItems).map(item => item.getAttribute('data-src'));
    
    galleryItems.forEach((item, index) => {
        item.addEventListener('click', () => {
            currentLightboxIndex = index;
            openLightbox();
        });
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('active')) return;
        
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') changeLightboxImage(-1);
        if (e.key === 'ArrowRight') changeLightboxImage(1);
    });

    // Click outside to close
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });
}

function openLightbox() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    
    lightbox.classList.add('active');
    lightboxImg.src = lightboxImages[currentLightboxIndex];
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
}

function changeLightboxImage(direction) {
    currentLightboxIndex += direction;
    
    if (currentLightboxIndex >= lightboxImages.length) {
        currentLightboxIndex = 0;
    } else if (currentLightboxIndex < 0) {
        currentLightboxIndex = lightboxImages.length - 1;
    }
    
    const lightboxImg = document.getElementById('lightbox-img');
    lightboxImg.style.opacity = '0';
    
    setTimeout(() => {
        lightboxImg.src = lightboxImages[currentLightboxIndex];
        lightboxImg.style.opacity = '1';
    }, 150);
}

// ==========================================================================
// Form Validation & Submit
// ==========================================================================

function initForm() {
    const form = document.getElementById('contactForm');
    const inputs = form.querySelectorAll('input[required]');
    
    // Real-time validation
    inputs.forEach(input => {
        input.addEventListener('blur', () => {
            validateField(input);
        });
        
        input.addEventListener('input', () => {
            if (input.classList.contains('error')) {
                validateField(input);
            }
        });
    });
}

function validateField(field) {
    const value = field.value.trim();
    let isValid = true;
    
    // Required check
    if (field.hasAttribute('required') && !value) {
        isValid = false;
    }
    
    // Phone validation
    if (field.type === 'tel' && value) {
        const phoneRegex = /^[+]?[0-9\s\-()]{10,}$/;
        isValid = phoneRegex.test(value);
    }
    
    // Checkbox validation
    if (field.type === 'checkbox' && field.hasAttribute('required')) {
        isValid = field.checked;
    }
    
    // Update UI
    if (isValid) {
        field.classList.remove('error');
    } else {
        field.classList.add('error');
    }
    
    return isValid;
}

function handleSubmit(event) {
    event.preventDefault();
    
    const form = document.getElementById('contactForm');
    const submitButton = form.querySelector('.submit-button');
    const inputs = form.querySelectorAll('input[required]');
    
    // Validate all fields
    let allValid = true;
    inputs.forEach(input => {
        if (!validateField(input)) {
            allValid = false;
        }
    });
    
    if (!allValid) {
        // Scroll to first error
        const firstError = form.querySelector('.error');
        if (firstError) {
            firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }
    
    // Show loading state
    submitButton.classList.add('loading');
    submitButton.disabled = true;
    
    // Simulate API call
    setTimeout(() => {
        submitButton.classList.remove('loading');
        submitButton.disabled = false;
        
        // Show success modal
        openModal();
        
        // Reset form
        form.reset();
        
        // Remove error classes
        inputs.forEach(input => input.classList.remove('error'));
        
        // Track conversion (Google Analytics, Facebook Pixel, etc.)
        if (typeof gtag !== 'undefined') {
            gtag('event', 'conversion', {
                'send_to': 'AW-CONVERSION_ID/CONVERSION_LABEL',
                'value': 1000.0,
                'currency': 'RUB'
            });
        }
    }, 1500);
}

// ==========================================================================
// Modal Functions
// ==========================================================================

function openModal() {
    const modal = document.getElementById('successModal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const modal = document.getElementById('successModal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

function showPrivacy() {
    alert('Политика конфиденциальности будет открыта в новом окне.\n\nВ реальной версии здесь будет ссылка на страницу с политикой конфиденциальности.');
    return false;
}

// ==========================================================================
// Scroll Animations
// ==========================================================================

function initScrollAnimations() {
    const animatedElements = document.querySelectorAll('.feature-card, .audience-card, .testimonial-card, .gallery-item');
    
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }, index * 100);
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    animatedElements.forEach(element => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(30px)';
        element.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(element);
    });
}

// ==========================================================================
// Phone Number Formatting
// ==========================================================================

function initPhoneFormatting() {
    const phoneInput = document.getElementById('phone');
    if (!phoneInput) return;
    
    phoneInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        
        if (value.length > 0) {
            if (value[0] === '8' || value[0] === '7') {
                value = '7' + value.substring(1);
            }
            
            let formatted = '+7';
            if (value.length > 1) {
                formatted += ' (' + value.substring(1, 4);
            }
            if (value.length >= 5) {
                formatted += ') ' + value.substring(4, 7);
            }
            if (value.length >= 8) {
                formatted += '-' + value.substring(7, 9);
            }
            if (value.length >= 10) {
                formatted += '-' + value.substring(9, 11);
            }
            
            e.target.value = formatted;
        }
    });
}

// ==========================================================================
// Floating Buttons
// ==========================================================================

function initFloatingButtons() {
    const floatingButtons = document.querySelector('.floating-buttons');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            floatingButtons.style.opacity = '1';
            floatingButtons.style.pointerEvents = 'auto';
        } else {
            floatingButtons.style.opacity = '0';
            floatingButtons.style.pointerEvents = 'none';
        }
    });
}

// ==========================================================================
// Lazy Loading Images
// ==========================================================================

function initLazyLoading() {
    const images = document.querySelectorAll('img[loading="lazy"]');
    
    if ('loading' in HTMLImageElement.prototype) {
        // Browser supports native lazy loading
        return;
    }
    
    // Fallback for browsers that don't support lazy loading
    const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src || img.src;
                imageObserver.unobserve(img);
            }
        });
    });
    
    images.forEach(img => imageObserver.observe(img));
}

// ==========================================================================
// Smooth Scroll for Anchor Links
// ==========================================================================

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href === '#' || href === '#privacy') return;
            
            e.preventDefault();
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// ==========================================================================
// Initialize Everything
// ==========================================================================

document.addEventListener('DOMContentLoaded', function() {
    // Initialize all features
    initHeaderScroll();
    animateStats();
    initCarousel();
    initGallery();
    initForm();
    initScrollAnimations();
    initPhoneFormatting();
    initFloatingButtons();
    initLazyLoading();
    initSmoothScroll();
    
    // Set initial styles for floating buttons
    const floatingButtons = document.querySelector('.floating-buttons');
    if (floatingButtons) {
        floatingButtons.style.opacity = '0';
        floatingButtons.style.transition = 'opacity 0.3s ease';
    }
    
    console.log('ZRT School website initialized successfully! 🏍️');
});

// ==========================================================================
// Performance Monitoring (Optional)
// ==========================================================================

if ('performance' in window) {
    window.addEventListener('load', () => {
        const perfData = performance.timing;
        const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
        console.log(`Page loaded in ${pageLoadTime}ms`);
    });
}

// ==========================================================================
// Service Worker Registration (Progressive Web App)
// ==========================================================================

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Uncomment when service worker is ready
        // navigator.serviceWorker.register('/sw.js')
        //     .then(reg => console.log('Service Worker registered'))
        //     .catch(err => console.log('Service Worker registration failed'));
    });
}