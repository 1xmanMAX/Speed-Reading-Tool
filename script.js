document.addEventListener('DOMContentLoaded', function() {
    // Variables
    let words = [];
    let currentIndex = 0;
    let timer = 120; // 2 minutos en segundos
    let wpm = 400;
    let wordsAtTime = 1;
    let fontSize = 60;
    let isPlaying = false;
    let interval;
    let timerInterval;
    let fullText = '';
    let currentBookTitle = '';
    let library = []; // Almacenará la colección de libros
    
    // Elementos DOM
    const wordDisplay = document.getElementById('word-display');
    const progressBar = document.getElementById('progress');
    const progressContainer = document.getElementById('progress-container');
    const playPauseBtn = document.getElementById('play-pause');
    const prevBtn = document.getElementById('prev');
    const nextBtn = document.getElementById('next');
    const restartBtn = document.getElementById('restart');
    const fullscreenBtn = document.getElementById('fullscreen');
    const fileInput = document.getElementById('file-input');
    const timerDisplay = document.getElementById('timer');
    const wpmDisplay = document.getElementById('wpm');
    const wordsAtTimeDisplay = document.getElementById('words-at-time');
    const fontSizeDisplay = document.getElementById('font-size');
    const decreaseWpmBtn = document.getElementById('decrease-wpm');
    const increaseWpmBtn = document.getElementById('increase-wpm');
    const decreaseWordsBtn = document.getElementById('decrease-words');
    const increaseWordsBtn = document.getElementById('increase-words');
    const decreaseFontBtn = document.getElementById('decrease-font');
    const increaseFontBtn = document.getElementById('increase-font');
    const decreaseTimerBtn = document.getElementById('decrease-timer');
    const increaseTimerBtn = document.getElementById('increase-timer');
    const fullTextDisplay = document.getElementById('full-text');
    const booksCollection = document.getElementById('books-collection');
    const dropZone = document.getElementById('drop-zone');
    const fileDropArea = document.querySelector('.file-drop-area');
    
    // Cargar biblioteca desde localStorage si existe
    function loadLibrary() {
        const savedLibrary = localStorage.getItem('fastReadingLibrary');
        if (savedLibrary) {
            library = JSON.parse(savedLibrary);
            updateLibraryDisplay();
        }
    }
    
    // Guardar biblioteca en localStorage
    function saveLibrary() {
        localStorage.setItem('fastReadingLibrary', JSON.stringify(library));
    }
    
    // Actualizar la visualización de la biblioteca
    function updateLibraryDisplay() {
        booksCollection.innerHTML = '';
        
        if (library.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-library';
            emptyMessage.textContent = 'No hay libros en tu biblioteca. Sube un archivo .txt para comenzar.';
            booksCollection.appendChild(emptyMessage);
            return;
        }
        
        library.forEach((book, index) => {
            const bookCard = document.createElement('div');
            bookCard.className = 'book-card';
            if (book.title === currentBookTitle) {
                bookCard.classList.add('active');
            }
            
            const bookTitle = document.createElement('div');
            bookTitle.className = 'book-title';
            bookTitle.textContent = book.title;
            
            const wordCount = document.createElement('div');
            wordCount.className = 'book-info';
            wordCount.textContent = `${book.wordCount} palabras`;
            
            const progress = document.createElement('div');
            progress.className = 'book-info';
            const progressPercent = Math.round((book.currentIndex / (book.wordCount - 1)) * 100) || 0;
            progress.textContent = `Progreso: ${progressPercent}%`;
            
            const progressBar = document.createElement('div');
            progressBar.className = 'book-progress';
            
            const progressBarFill = document.createElement('div');
            progressBarFill.className = 'book-progress-bar';
            progressBarFill.style.width = `${progressPercent}%`;
            
            progressBar.appendChild(progressBarFill);
            
            // Botón para eliminar libro
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-book';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = 'Eliminar libro';
            
            // Evento para eliminar el libro
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Evitar que se active el evento de clic de la tarjeta
                deleteBook(index);
            });
            
            bookCard.appendChild(bookTitle);
            bookCard.appendChild(wordCount);
            bookCard.appendChild(progress);
            bookCard.appendChild(progressBar);
            bookCard.appendChild(deleteBtn);
            
            // Evento para cargar el libro al hacer clic
            bookCard.addEventListener('click', () => {
                loadBookFromLibrary(index);
            });
            
            booksCollection.appendChild(bookCard);
        });
    }
    
    // Función para eliminar un libro de la biblioteca
    function deleteBook(index) {
        if (confirm(`¿Estás seguro de que deseas eliminar "${library[index].title}" de tu biblioteca?`)) {
            // Si el libro que se está eliminando es el que está actualmente cargado
            if (library[index].title === currentBookTitle) {
                // Limpiar la visualización
                fullText = '';
                words = [];
                currentIndex = 0;
                currentBookTitle = '';
                updateDisplay();
                updateProgress();
                displayFullText();
            }
            
            // Eliminar el libro de la biblioteca
            library.splice(index, 1);
            saveLibrary();
            updateLibraryDisplay();
        }
    }
    
    // Cargar un libro desde la biblioteca
    function loadBookFromLibrary(index) {
        const book = library[index];
        if (!book) return;
        
        fullText = book.text;
        words = book.text.split(/\s+/).filter(word => word.length > 0);
        currentIndex = book.currentIndex || 0;
        currentBookTitle = book.title;
        
        updateDisplay();
        updateProgress();
        displayFullText();
        updateLibraryDisplay();
    }
    
    // Función para procesar el archivo
    function processFile(file) {
        if (!file || !file.name.toLowerCase().endsWith('.txt')) {
            alert('Por favor, selecciona un archivo de texto (.txt)');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            fullText = text;
            words = text.split(/\s+/).filter(word => word.length > 0);
            currentIndex = 0;
            currentBookTitle = file.name;
            
            // Añadir o actualizar el libro en la biblioteca
            const existingBookIndex = library.findIndex(book => book.title === file.name);
            
            if (existingBookIndex !== -1) {
                // Actualizar libro existente
                library[existingBookIndex].text = text;
                library[existingBookIndex].wordCount = words.length;
                library[existingBookIndex].lastOpened = new Date().toISOString();
            } else {
                // Añadir nuevo libro
                library.push({
                    title: file.name,
                    text: text,
                    wordCount: words.length,
                    currentIndex: 0,
                    lastOpened: new Date().toISOString()
                });
            }
            
            saveLibrary();
            updateLibraryDisplay();
            updateDisplay();
            updateProgress();
            displayFullText();
        };
        reader.readAsText(file);
    }
    
    // Evento para el input de archivo tradicional
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        processFile(file);
    });
    
    // Implementación de arrastrar y soltar (drag and drop)
    
    // Prevenir el comportamiento predeterminado solo en el área de soltar
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        fileDropArea.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    // Resaltar SOLO la zona específica de soltar cuando se arrastra un archivo sobre ella
    ['dragenter', 'dragover'].forEach(eventName => {
        fileDropArea.addEventListener(eventName, highlightDropArea, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        fileDropArea.addEventListener(eventName, unhighlightDropArea, false);
    });
    
    // Eliminar los eventos del dropZone (toda la interfaz)
    // Ya no necesitamos estos eventos en toda la interfaz
    // dropZone.addEventListener('dragenter', highlight, false);
    // dropZone.addEventListener('dragover', highlight, false);
    // dropZone.addEventListener('dragleave', unhighlight, false);
    // dropZone.addEventListener('drop', handleDrop, false);
    
    function highlightDropArea() {
        fileDropArea.classList.add('active');
    }
    
    function unhighlightDropArea() {
        fileDropArea.classList.remove('active');
    }
    
    // Manejar el evento de soltar archivos SOLO en el área designada
    fileDropArea.addEventListener('drop', handleDrop, false);
    
    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length > 0) {
            processFile(files[0]);
        }
    }
    
    // Función para mostrar el texto completo en el panel derecho
    function displayFullText() {
        if (!fullText) {
            fullTextDisplay.textContent = "Carga un archivo de texto para ver el contenido completo.";
            return;
        }
        
        // Crear un array de palabras con índices
        const wordsWithIndices = [];
        let currentPosition = 0;
        
        words.forEach((word, index) => {
            const startPos = fullText.indexOf(word, currentPosition);
            if (startPos !== -1) {
                wordsWithIndices.push({
                    word: word,
                    index: index,
                    start: startPos,
                    end: startPos + word.length
                });
                currentPosition = startPos + word.length;
            }
        });
        
        // Construir el HTML con la palabra actual resaltada
        let htmlContent = '';
        let lastEnd = 0;
        
        wordsWithIndices.forEach((wordObj, i) => {
            // Añadir texto entre palabras
            if (wordObj.start > lastEnd) {
                htmlContent += fullText.substring(lastEnd, wordObj.start);
            }
            
            // Añadir la palabra con o sin resaltado
            if (i === currentIndex) {
                htmlContent += `<span class="current-word" id="word-${i}">${wordObj.word}</span>`;
            } else {
                htmlContent += `<span id="word-${i}">${wordObj.word}</span>`;
            }
            
            lastEnd = wordObj.end;
        });
        
        // Añadir cualquier texto restante
        if (lastEnd < fullText.length) {
            htmlContent += fullText.substring(lastEnd);
        }
        
        fullTextDisplay.innerHTML = htmlContent;
        
        // Desplazarse a la palabra actual
        const currentWordElement = document.getElementById(`word-${currentIndex}`);
        if (currentWordElement) {
            currentWordElement.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }
    
    // Función para actualizar la visualización de palabras
    function updateDisplay() {
        if (words.length === 0) {
            wordDisplay.textContent = "Carga un archivo de texto";
            return;
        }
        
        if (currentIndex >= words.length) {
            stopReading();
            currentIndex = words.length - 1;
            return;
        }
        
        let displayText = '';
        
        if (wordsAtTime === 1) {
            const word = words[currentIndex];
            // Resaltar la letra del centro (aproximadamente)
            const middleIndex = Math.floor(word.length / 2);
            displayText = word.substring(0, middleIndex) + 
                          '<span class="highlight">' + word.charAt(middleIndex) + '</span>' + 
                          word.substring(middleIndex + 1);
        } else {
            // Mostrar múltiples palabras
            const endIndex = Math.min(currentIndex + wordsAtTime, words.length);
            displayText = words.slice(currentIndex, endIndex).join(' ');
        }
        
        wordDisplay.innerHTML = displayText;
        wordDisplay.style.fontSize = fontSize + 'px';
        
        // Actualizar el resaltado en el texto completo
        displayFullText();
        
        // Actualizar el progreso en la biblioteca
        updateBookProgress();
    }
    
    // Actualizar el progreso del libro actual en la biblioteca
    function updateBookProgress() {
        if (!currentBookTitle) return;
        
        const bookIndex = library.findIndex(book => book.title === currentBookTitle);
        if (bookIndex !== -1) {
            library[bookIndex].currentIndex = currentIndex;
            saveLibrary();
            updateLibraryDisplay();
        }
    }
    
    // Función para actualizar la barra de progreso
    function updateProgress() {
        if (words.length === 0) {
            progressBar.style.width = '0%';
            return;
        }
        
        const progress = (currentIndex / (words.length - 1)) * 100;
        progressBar.style.width = progress + '%';
    }
    
    // Función para iniciar la lectura
    function startReading() {
        if (words.length === 0) return;
        
        // Si ya está reproduciendo, no hacer nada
        if (isPlaying) return;
        
        isPlaying = true;
        playPauseBtn.textContent = '❚❚'; // Símbolo de pausa
        
        const msPerWord = 60000 / wpm;
        
        // Asegurarse de limpiar cualquier intervalo existente
        clearInterval(interval);
        
        // Iniciar el cronómetro si no está activo
        if (!timerInterval) {
            startTimer();
        }
        
        // Establecer un nuevo intervalo para la reproducción continua
        interval = setInterval(() => {
            currentIndex += wordsAtTime;
            
            // Verificar si hemos llegado al final
            if (currentIndex >= words.length || timer <= 0) {
                stopReading();
                return;
            }
            
            updateDisplay();
            updateProgress();
        }, msPerWord);
    }
    
    // Función para iniciar el cronómetro
    function startTimer() {
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (timer > 0) {
                timer--;
                updateTimer();
            } else {
                stopReading();
                clearInterval(timerInterval);
                timerInterval = null;
            }
        }, 1000);
    }
    
    // Función para detener la lectura
    function stopReading() {
        isPlaying = false;
        playPauseBtn.textContent = '▶'; // Símbolo de reproducción
        clearInterval(interval);
        
        // Detener el cronómetro
        clearInterval(timerInterval);
        timerInterval = null;
        
        // Guardar el progreso
        updateBookProgress();
    }
    
    // Función para actualizar el temporizador
    function updateTimer() {
        const minutes = Math.floor(timer / 60);
        const seconds = timer % 60;
        timerDisplay.textContent = `${minutes} min ${seconds.toString().padStart(2, '0')}`;
        
        if (timer <= 0) {
            timerDisplay.textContent = '0 min 00';
        }
    }
    
    // Función para saltar a una posición específica en el texto
    function jumpToPosition(position) {
        if (words.length === 0) return;
        
        // Calcular el índice basado en la posición porcentual
        const newIndex = Math.floor((position / 100) * (words.length - 1));
        currentIndex = Math.max(0, Math.min(words.length - 1, newIndex));
        
        updateDisplay();
        updateProgress();
    }
    
    // Event listeners para los controles
    playPauseBtn.addEventListener('click', () => {
        if (isPlaying) {
            stopReading();
        } else {
            startReading();
        }
    });
    
    prevBtn.addEventListener('click', () => {
        currentIndex = Math.max(0, currentIndex - 10);
        updateDisplay();
        updateProgress();
    });
    
    nextBtn.addEventListener('click', () => {
        currentIndex = Math.min(words.length - 1, currentIndex + 10);
        updateDisplay();
        updateProgress();
    });
    
    restartBtn.addEventListener('click', () => {
        stopReading();
        currentIndex = 0;
        timer = 120;
        updateTimer();
        updateDisplay();
        updateProgress();
    });
    
    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    });
    
    // Hacer la barra de progreso interactiva
    progressContainer.addEventListener('click', function(e) {
        const rect = progressContainer.getBoundingClientRect();
        const position = ((e.clientX - rect.left) / rect.width) * 100;
        
        // Actualizar visualmente la barra de progreso
        progressBar.style.width = position + '%';
        
        // Saltar a esa posición en el texto
        jumpToPosition(position);
    });
    
    // Mostrar previsualización al pasar el mouse sobre la barra de progreso
    progressContainer.addEventListener('mousemove', function(e) {
        if (words.length === 0) return;
        
        const rect = progressContainer.getBoundingClientRect();
        const position = ((e.clientX - rect.left) / rect.width) * 100;
        
        // Calcular el índice basado en la posición porcentual
        const previewIndex = Math.floor((position / 100) * (words.length - 1));
        
        // Mostrar una previsualización de la palabra en esa posición
        const tooltip = document.getElementById('preview-tooltip');
        if (tooltip) {
            tooltip.textContent = words[previewIndex];
            tooltip.style.display = 'block';
            tooltip.style.left = e.clientX + 'px';
        }
    });
    
    progressContainer.addEventListener('mouseout', function() {
        const tooltip = document.getElementById('preview-tooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    });
    
    // Permitir hacer clic en palabras en el panel de texto completo
    fullTextDisplay.addEventListener('click', function(e) {
        if (e.target.id && e.target.id.startsWith('word-')) {
            const wordIndex = parseInt(e.target.id.split('-')[1]);
            if (!isNaN(wordIndex)) {
                currentIndex = wordIndex;
                updateDisplay();
                updateProgress();
            }
        }
    });
    
    // Controles para ajustar WPM
    decreaseWpmBtn.addEventListener('click', () => {
        wpm = Math.max(100, wpm - 50);
        wpmDisplay.textContent = wpm;
        if (isPlaying) {
            stopReading();
            startReading();
        }
    });
    
    increaseWpmBtn.addEventListener('click', () => {
        wpm = wpm + 50;
        wpmDisplay.textContent = wpm;
        if (isPlaying) {
            stopReading();
            startReading();
        }
    });
    
    // Controles para ajustar palabras a la vez
    decreaseWordsBtn.addEventListener('click', () => {
        wordsAtTime = Math.max(1, wordsAtTime - 1);
        wordsAtTimeDisplay.textContent = wordsAtTime;
        updateDisplay();
    });
    
    increaseWordsBtn.addEventListener('click', () => {
        wordsAtTime = wordsAtTime + 1;
        wordsAtTimeDisplay.textContent = wordsAtTime;
        updateDisplay();
    });
    
    // Controles para ajustar tamaño de fuente
    decreaseFontBtn.addEventListener('click', () => {
        fontSize = Math.max(20, fontSize - 5);
        fontSizeDisplay.textContent = fontSize;
        updateDisplay();
    });
    
    increaseFontBtn.addEventListener('click', () => {
        fontSize = fontSize + 5;
        fontSizeDisplay.textContent = fontSize;
        updateDisplay();
    });
    
    // Controles para ajustar el temporizador
    decreaseTimerBtn.addEventListener('click', () => {
        timer = Math.max(30, timer - 30);
        updateTimer();
    });
    
    increaseTimerBtn.addEventListener('click', () => {
        timer = timer + 30;
        updateTimer();
    });
    
    // Inicializar la aplicación
    loadLibrary();
    updateTimer();
    updateDisplay();
});